import { UnifiedIR, PruneIRType, convertToUnifiedIR, pruneIR } from "../ir"

import camelcase from "camelcase"

export type IR2GoStructOption = {
	additionalAcronyms?: string[]
	usePointerField?: boolean
	usePointerFieldForRequired?: boolean
	tagTemplate?: string
	tagRequiredTemplate?: string
}

const convert2GoPublicFieldName = (n: string, additionalAcronyms: string[]) => {
	const acronyms = ["id", "api", "http", "url", "uri", ...additionalAcronyms]
	const acronymsReplace = (i: string) =>
		acronyms.reduce(
			(i, ac) =>
				i.replace(
					new RegExp(
						ac[0].toUpperCase() + ac.slice(1).toLowerCase(),
						"g"
					),
					ac.toUpperCase()
				),
			i
		)

	return acronymsReplace(camelcase(n, { pascalCase: true }))
}

const NAME_KEY = /%name%/g
const renderTagTemplate = (temp: string, name: string) =>
	temp.replace(NAME_KEY, name)

const PADDING = "\t"
export const ir2gostruct = (
	ir: UnifiedIR,
	{
		additionalAcronyms = [],
		usePointerField = false,
		usePointerFieldForRequired = true,
		tagTemplate = `json:"%name%"`,
		tagRequiredTemplate = `json:"%name%"`,
	}: IR2GoStructOption
): string => {
	const options = {
		additionalAcronyms,
		usePointerField,
		usePointerFieldForRequired,
		tagTemplate,
		tagRequiredTemplate,
	}
	switch (ir.type) {
		case "any":
			return "json.RawMessage"
		case "bool":
		case "int":
		case "string":
			return ir.type
		case "float":
			return "float64" // 64bit システムを前提にする
		case "slice":
			return `[]${ir2gostruct(ir.of, options)}`
		case "struct":
			// ポインタにして null や undefined だったかどうかを判別できるようにする
			// 必須だったら `jv:"nonnil"` をつける
			return `struct {
${PADDING}${Object.entries(ir.fields)
				.map(([k, v]) =>
					[
						convert2GoPublicFieldName(k, additionalAcronyms),
						(
							v.optional
								? usePointerField
								: usePointerFieldForRequired
						)
							? `*(${ir2gostruct(v.of, options)})`
							: ir2gostruct(v.of, options),
						`\`${renderTagTemplate(
							!v.optional ? tagRequiredTemplate : tagTemplate,
							k
						)}\``,
					].join(PADDING)
				)
				.join("\n")
				.split("\n")
				.join("\n" + PADDING)}
}`
	}
}

export const obj2GoStruct = (
	filter: PruneIRType | null | undefined,
	options: IR2GoStructOption,
	...a: any[]
) => {
	const uir = convertToUnifiedIR(...a)
	return ir2gostruct(filter ? pruneIR(uir, filter) : uir, options)
}
