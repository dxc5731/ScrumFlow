export interface ComposerToken { kind: "agent" | "entity"; start: number; end: number; fragment: string }

export function composerTokenAt(text: string, cursor: number): ComposerToken | null {
  const before = text.slice(0, cursor)
  const match = /[@＠#＃]([^\s@＠#＃]*)$/.exec(before)
  if (!match) return null
  if (match.index > 0 && /[a-zA-Z0-9_.+-]/.test(text[match.index - 1])) return null
  return { kind: /[@＠]/.test(match[0][0]) ? "agent" : "entity", start: match.index, end: cursor, fragment: match[1] }
}

export function insertComposerReference(text: string, token: ComposerToken, value: string) {
  const insertion = `${token.kind === "agent" ? "@" : "#"}${value} `
  return { text: text.slice(0, token.start) + insertion + text.slice(token.end), cursor: token.start + insertion.length }
}
