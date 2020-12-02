import { PruneIRType } from "./ir"
import { obj2GoStruct } from "./ir2go"

import { promises as fs } from "fs"

import $ from "transform-ts"
import glob from "glob"

const configSchema = $.obj({
	glob: $.string,
	// コンパイラに怒られる abbr はジェネレータコードが担保するが、外からも差し込めるようにする
	abbrMustBeUpperCase: $.optional($.nullable($.array($.string))),
	usePointerField: $.optional($.nullable($.boolean)),
	usePointerFieldForRequired: $.optional($.nullable($.boolean)),
	tagTemplate: $.optional($.nullable($.string)),
	tagRequiredTemplate: $.optional($.nullable($.string)),
	filter: $.optional($.nullable($.any)), // prune に入力する PruneIRType を期待
})

const main = async () => {
	const configFile = process.argv[2]
	const config = configSchema.transformOrThrow(
		JSON.parse((await fs.readFile(configFile)).toString("utf-8"))
	)

	const files = await new Promise<string[]>((res, rej) =>
		glob(config.glob, (err, files) => (err ? rej(err) : res(files)))
	)

	console.log(
		obj2GoStruct(
			config.filter as PruneIRType | null,
			{
				additionalAcronyms: config.abbrMustBeUpperCase || undefined,
				tagTemplate: config.tagTemplate || undefined,
				tagRequiredTemplate: config.tagRequiredTemplate || undefined,
				usePointerField:
					config.usePointerField === undefined ||
					config.usePointerField === null
						? undefined
						: config.usePointerField,
				usePointerFieldForRequired:
					config.usePointerFieldForRequired === undefined ||
					config.usePointerFieldForRequired === null
						? undefined
						: config.usePointerFieldForRequired,
			},
			...(await Promise.all(
				files.map((f) =>
					fs.readFile(f).then((b) => JSON.parse(b.toString()))
				)
			))
		)
	)
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error(e)
		process.exit(1)
	})
