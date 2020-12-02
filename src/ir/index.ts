type IRType<E = void> = Exclude<
	IRPrimitive | IRStruct<E> | IRAny | IRSlice<E> | IRUnion | IRIgnore,
	E
>

const IR_PRIMITIVE_TYPE = ["bool", "string", "int", "float"] as const
type IRPrimitive = {
	type: typeof IR_PRIMITIVE_TYPE[number]
}

// IRUnion
type IRAny = {
	type: "any"
}

// 中間表現
type IRStruct<E = void> = {
	type: "struct" // type がなかったら struct 扱いする
	fields: {
		[key: string]: {
			optional?: true
			of: Exclude<IRType<E>, E>
		}
	}
}

type IRSlice<E = void> = {
	type: "slice"
	of: Exclude<IRType<E>, E>
}

// Go に Union の概念はないのであとで併合する。しかしどう考えても正しい内部表現には必要
// ただしこいつは optional かどうかを判定しない。これを解消しないと optional かどうかは判明しないため
type IRUnion = {
	type: "union"
	of: IRTypeWithoutUnion[]
}

// null のときにこれにする、Union 時に無視するが optional になるようなコードにするためのマーカー
type IRIgnore = {
	type: "ignore"
}

// IRType ユーティリティタイプです
type IRTypeWithoutUnion = Exclude<IRType, IRUnion>

type ValueOf<T extends { [key: string]: any }> = T extends {
	[key: string]: infer U
}
	? U
	: never
const mapObjectValue = <T extends { [key: string]: any }, U>(
	a: T,
	fn: (v: ValueOf<T>) => U
): { [k in keyof T]: U } => {
	const o: Partial<{ [k in keyof T]: U }> = {}
	Object.keys(a).forEach((k: keyof T) => {
		o[k] = fn(a[k] as any)
	})
	return o as { [k in keyof T]: U } // ! force type assertion !
}
const unique = <T>(a: T[]): T[] => {
	const set = new Set<T>()
	a.forEach((v) => set.add(v))
	return Array.from(set.values())
}

/**
 * # convertObject2IR
 * 型情報を any から推測します。推測できない型が来たら panic します
 * 配列のみ一意に型が決定せず、子ごとに IRType になり、それらの IRUnion が inner type となります
 */
const convertObject2IR = (a: any): IRType => {
	if (Number.isInteger(a)) return { type: "int" }
	if (typeof a === "number" && !Number.isNaN(a)) return { type: "float" }

	if (typeof a === "string") return { type: "string" }
	if (typeof a === "boolean") return { type: "bool" }

	if (Array.isArray(a)) {
		const innerList = a.map((inner) => convertObject2IR(inner))
		return {
			type: "slice",
			of: {
				type: "union",
				of: [
					...innerList.filter(
						(ir): ir is IRTypeWithoutUnion => ir.type !== "union"
					),
					// IRUnion が返ってきていたら解除する
					...innerList
						.filter((ir): ir is IRUnion => ir.type === "union")
						.map((u) => u.of)
						.flat(),
				],
			},
		}
	}
	if (Object.prototype.toString.call(a) === "[object Object]") {
		return {
			type: "struct",
			fields: mapObjectValue(a, (v) => ({ of: convertObject2IR(v) })),
		}
	}

	if (Object.prototype.toString.call(a) === "[object Null]") {
		return {
			type: "ignore",
		}
	}

	// 対応してない型がきちゃったね
	throw new Error(`知らん型だぞ: ${a}`)
}

const isIRPrimitive = (a: IRType): a is IRPrimitive =>
	IR_PRIMITIVE_TYPE.includes(a.type as any)

/**
 * # unifyIRUnion
 *
 * IRUnion をマージします。破壊的変更を加えるかもしれないので、必要なら事前に deep-copy してください
 *
 * ## マージとは
 * IRUnion を IRUnion ではない型にする手続きのこと
 *
 * - of に Union が含まれるなら再帰的に Union の中身を self.of に追加し top-level の IRUnion のみが IRUnion である状況にする
 *  + この処理は Union を作成する処理に組み込んでもよい (そのほうが事前条件を絞りやすい)
 * - of に IRAny が含まれるなら IRAny に統一 (widening)
 *  + これは次の条件と同時に扱えるので、説明上にしか存在しない処理
 * - of が複数の型を持つなら IRAny にする (widening)
 *  + Union はないので諦める
 * - of が Primitive ならそれらの型に unwrap (属性を持たないため)
 * - of が Slice なら of の inner を全て Union として集合させてからマージの手続きを行う
 *  + 問題: Union の Union で死にそう => 最初に Union がトップにしかないことをチェックすればよい
 * - of が Struct のみなら、フィールド毎に IRUnion を作り、再帰的に IRUnion を統合する。注意がある
 *  + この際、of に含まれる数とフィールドの IRUnion.of の数が異なる場合は Optional として扱う
 *      * 共通項のみを required とする論理より扱いやすいはず
 */
const unifyIRUnion = (a: IRType): IRType<IRUnion | IRIgnore> => {
	if (a.type !== "union") {
		if (isIRPrimitive(a) || a.type === "any") return a
		if (a.type === "slice") {
			return {
				type: a.type,
				of: unifyIRUnion(a.of),
			}
		}
		if (a.type === "struct") {
			return {
				type: a.type,
				fields: mapObjectValue(a.fields, ({ of, ...rest }) => ({
					...rest,
					of: unifyIRUnion(of),
				})),
			}
		}
		// 追加処理を書くときに後続処理の前にここで推論が止まってほしい
		throw new Error("unreachable")
	}

	// ignore は無視して考える
	const types = unique(a.of.map((n) => n.type))
	const typesWithoutIgnore = types.filter((v) => v !== "ignore")

	// ignore は無視して一個に定まれば OK
	if (typesWithoutIgnore.length !== 1) {
		// memo: types.length === 0 のときも any になる (空の slice のときに発生する)
		// types.length === 0 のときはまぁしょうがないかもしれない

		// float と int しかなければ float に寄せる (このとき Ignore は当然含んで考える必要がある
		if (
			types.length === 2 &&
			types.includes("int") &&
			types.includes("float")
		) {
			return { type: "float" } // widening
		}

		return { type: "any" }
	}

	const type = typesWithoutIgnore[0]
	switch (type) {
		case "ignore":
			// type として ignore が来ることはない (除外しているリストから取っているのだから)
			throw new Error("unreachable")
		case "any":
		case "int":
		case "float":
		case "string":
		case "bool":
			return { type }
		case "slice":
			// a.of に IRIgnore が来ることはない
			// root が Slice or Struct であるという制約があり、slice と struct のどちらでもフィールドや子要素の Union に IRIgnore が含まれていたら即座に any にする処理を入れている
			// よって、この関数の再帰呼び出し中に関してのみ、落ちてくることはない
			const slices = a.of as IRSlice[]
			const allOf = slices
				.map((s) => s.of)
				.flat()
				.flatMap((a) => {
					if (a.type !== "union") return a
					return a.of
				})
			if (allOf.some((n) => n.type === "ignore")) {
				// ignore が含まれている場合、object ならば optional フィールド扱いすればいいが slice の場合 どうやってもまともに処理できないので諦める
				return {
					type: "slice",
					of: { type: "any" },
				}
			}
			return unifyIRUnion({
				type: "slice",
				of: {
					type: "union",
					of: allOf,
				},
			})
		case "struct":
			// slice の際と同様に、ここに IRIgnore が来ることはない
			const structs = a.of as IRStruct[]
			const fields: Record<string, { of: IRUnion; optional?: true }> = {}
			structs.forEach((s) => {
				Object.entries(s.fields).forEach(([key, value]) => {
					if (!(key in fields)) {
						// initialize field
						fields[key] = {
							of: {
								type: "union",
								// union なら unwind
								of:
									value.of.type === "union"
										? value.of.of
										: [value.of],
							},
						}
						// 初期化したら加算処理はしない
						return
					}
					if (value.of.type === "union") {
						return fields[key].of.of.push(...value.of.of)
					}
					fields[key].of.of.push(value.of)
				})
			})
			// field の ignore が存在すれば IRUnion から除外してしまう
			Object.entries(fields).forEach(([k, v]) => {
				// ignore が含まれないならなにもしない
				v.of.of = v.of.of.filter((n) => n.type !== "ignore")
				fields[k] = v
			})
			return {
				type: "struct",
				fields: mapObjectValue(fields, ({ of, ...rest }) => {
					const rv = { ...rest, of: unifyIRUnion(of) }
					if (of.of.length < structs.length) rv.optional = true
					return rv
				}),
			}
	}
}

export type UnifiedIR = IRType<IRUnion | IRIgnore>

// 複数の object を一つの型として扱って合成した型を返却します
// 推論に失敗した (常に null だった、異なる型を合成した) 場合は any になります
export const convertToUnifiedIR = (...objects: any[]): UnifiedIR => {
	const of = objects.map((o) => convertObject2IR(o))
	const nonExpectedTypes = unique(of.map((n) => n.type))
		.filter((t) => t !== "struct")
		.filter((t) => t !== "slice")
	if (nonExpectedTypes.length)
		throw new Error("本来来るはずのない type が来た: " + nonExpectedTypes)

	return unifyIRUnion({
		type: "union",
		of: of as IRType<IRUnion>[],
	})
}

export type PruneIRType = {
	type?: "slice" // なければ struct
	// この構造は暗にトップレベルが struct であることを期待しています (array をそのまま受けいれるということができない)
	of: {
		[k: string]:
			| boolean
			| (Partial<PruneIRType> & {
					// 編集できるので、その設定 (prune という名前にそれがあるのっていいの?)
					forceType?: IRType<IRIgnore | IRUnion>
					forceOptional?: boolean
			  })
	}
}

/**
 * 必要なフィールドを指定することで、不要なフィールドをIRから除去できます
 */
export const pruneIR = (
	a: IRType<IRUnion | IRIgnore>,
	p: PruneIRType
): IRType<IRUnion | IRIgnore> => {
	if (!p.of) throw new Error("違法なフィルタ設定です")

	const expected = p.type || "struct"
	if (a.type !== expected)
		throw new Error(
			`unexpected type ${a.type} encounted. ${expected} expected.`
		)

	switch (a.type) {
		case "slice":
			return {
				type: a.type,
				of: pruneIR(a.of, { of: p.of }),
			}
		case "struct":
			const fields = Object.entries(p.of)
				.map(([k, p]): [
					string,
					undefined | IRStruct<IRUnion | IRIgnore>["fields"][number]
				] => {
					if (!p) return [k, undefined]
					if (!a.fields[k]) throw new Error(`${k} is not found`)
					if (p === true) return [k, a.fields[k]]
					const rv: IRStruct<IRUnion | IRIgnore>["fields"][number] = {
						...a.fields[k],
					}
					if (p.forceType) rv.of = p.forceType
					if (p.forceOptional) rv.optional = true
					// child
					if (p.of) rv.of = pruneIR(rv.of, { of: p.of, type: p.type })
					return [k, rv]
				})
				.reduce((acc, [k, field]) => {
					if (!field) return acc
					acc[k] = field
					return acc
				}, {} as IRStruct<IRUnion | IRIgnore>["fields"])
			return {
				type: a.type,
				fields,
			}
	}

	throw new Error("unreachable")
}
