// The part of yaml 2.9.1's API used by the BMad project reader.

export interface YAMLError {
  code: string
  message: string
  /** Offsets into the source: [start, end). */
  pos: [number, number]
}

export interface Range {
  /** [start, value end, node end] offsets into the source. */
  range?: [number, number, number] | null
}

export interface Scalar extends Range {
  value: unknown
  type?: string
}

export interface Pair {
  key: unknown
  value: unknown
}

export interface YAMLMap extends Range {
  items: Pair[]
}

export interface YAMLSeq extends Range {
  items: unknown[]
}

export interface Alias extends Range {
  source: string
  resolve(doc: Document): unknown
}

export interface Document {
  contents: unknown
  errors: YAMLError[]
  warnings: YAMLError[]
  toJS(options?: { maxAliasCount?: number }): unknown
}

export interface ParseOptions {
  merge?: boolean
  uniqueKeys?: boolean
  prettyErrors?: boolean
  keepSourceTokens?: boolean
  strict?: boolean
  stringKeys?: boolean
  intAsBigInt?: boolean
  version?: '1.1' | '1.2'
}

export function parseDocument(source: string, options?: ParseOptions): Document
export function isAlias(node: unknown): node is Alias
export function isMap(node: unknown): node is YAMLMap
export function isScalar(node: unknown): node is Scalar
export function isSeq(node: unknown): node is YAMLSeq
