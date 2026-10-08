import { marked, type Token, type Tokens } from "marked"
import { safeMaterialFilename, validateDiagramSource, type MaterialArtifact } from "./materialSchema"

export interface GeneratedMaterialFile { name: string; blob: Blob; sourceText: string }
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!)

export async function renderMaterialDiagram(source: string): Promise<{ svg: string; png: Blob }> {
  const code = validateDiagramSource(source)
  const [{ default: mermaid }, { default: DOMPurify }] = await Promise.all([import("mermaid"), import("dompurify")])
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral", look: "classic", htmlLabels: false, suppressErrorRendering: true,
    fontFamily: '"Microsoft YaHei", "Noto Sans CJK SC", sans-serif', flowchart: { htmlLabels: false, useMaxWidth: false },
    usecase: { actorFontSize: 16, usecaseFontSize: 16, actorFontFamily: '"Microsoft YaHei", sans-serif', usecaseFontFamily: '"Microsoft YaHei", sans-serif', wrappingWidth: 190, minNodeWidth: 190 },
    themeVariables: { fontSize: "16px", background: "#ffffff" }, maxTextSize: 50000 })
  const id = `material-${crypto.randomUUID()}`
  try {
    await mermaid.parse(code)
    const result = await mermaid.render(id, code)
    const original = new DOMParser().parseFromString(result.svg, "image/svg+xml").documentElement
    // Native usecase SVG labels start at the ellipse centre. Standalone images
    // need an explicit anchor to retain the centred labels after sanitizing.
    for (const label of original.querySelectorAll(".usecase-ellipse .label text")) label.setAttribute("text-anchor", "middle")
    // Journey diagrams still emit HTML labels even with htmlLabels:false. Convert only
    // their plain text to SVG before sanitizing so exported images retain Chinese labels.
    const namespace = "http://www.w3.org/2000/svg"
    for (const foreign of original.querySelectorAll("foreignObject")) {
      const value = (foreign.querySelector(".label")?.textContent ?? foreign.textContent ?? "").trim()
      const x = Number(foreign.getAttribute("x") ?? 0), y = Number(foreign.getAttribute("y") ?? 0)
      const width = Number(foreign.getAttribute("width") ?? 160), height = Number(foreign.getAttribute("height") ?? 50)
      const label = document.createElementNS(namespace, "text")
      label.setAttribute("x", String(x + width / 2))
      label.setAttribute("text-anchor", "middle")
      label.setAttribute("font-size", "16")
      label.setAttribute("fill", "#172033")
      const chunks: string[] = []
      const measure = document.createElement("canvas").getContext("2d")
      if (measure) measure.font = '16px "Microsoft YaHei", sans-serif'
      let line = ""
      for (const char of value) {
        if (line && (char === "\n" || (measure?.measureText(line + char).width ?? (line.length + 1) * 16) > Math.max(32, width - 12))) {
          chunks.push(line); line = ""
        }
        if (char !== "\n") line += char
      }
      if (line) chunks.push(line)
      label.setAttribute("y", String(y + height / 2 - (chunks.length - 1) * 10 + 5))
      for (const [index, text] of chunks.entries()) {
        const span = document.createElementNS(namespace, "tspan")
        span.setAttribute("x", String(x + width / 2)); span.setAttribute("dy", index ? "20" : "0")
        span.textContent = text; label.appendChild(span)
      }
      foreign.replaceWith(label)
    }
    const svg = DOMPurify.sanitize(new XMLSerializer().serializeToString(original), { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ["style"] })
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement
    if (parsed.querySelector("foreignObject") || !parsed.querySelector("text")) throw new Error("图表标签没有转换为可导出的文字，请重新生成")
    const box = parsed.getAttribute("viewBox")?.split(/[ ,]+/).map(Number) ?? [0, 0, 1200, 800]
    const width = Math.ceil(box[2] || 1200), height = Math.ceil(box[3] || 800)
    parsed.setAttribute("width", String(width)); parsed.setAttribute("height", String(height))
    parsed.setAttribute("xmlns", "http://www.w3.org/2000/svg")
    const standalone = new XMLSerializer().serializeToString(parsed)
    const url = URL.createObjectURL(new Blob([standalone], { type: "image/svg+xml;charset=utf-8" }))
    try {
      const picture = new Image()
      await new Promise<void>((resolve, reject) => { picture.onload = () => resolve(); picture.onerror = () => reject(new Error("图表图片无法解码")); picture.src = url })
      const canvas = document.createElement("canvas")
      const scale = Math.min(2, 8000 / width, 8000 / height, Math.sqrt(20_000_000 / (width * height)))
      canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale))
      const ctx = canvas.getContext("2d")
      if (!ctx) throw new Error("浏览器无法导出图表")
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(picture, 0, 0, canvas.width, canvas.height)
      const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNG 导出失败")), "image/png"))
      return { svg: standalone, png }
    } finally { URL.revokeObjectURL(url) }
  } finally { document.getElementById(`d${id}`)?.remove(); document.getElementById(id)?.remove() }
}

export async function documentFiles(title: string, markdown: string): Promise<GeneratedMaterialFile[]> {
  const docx = await import("docx")
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, Header, Footer, PageNumber, AlignmentType } = docx
  function runs(tokens: Token[] | undefined, raw = ""): InstanceType<typeof TextRun>[] {
    if (!tokens?.length) return [new TextRun(raw)]
    return tokens.flatMap((token): InstanceType<typeof TextRun>[] => {
      if (token.type === "strong" || token.type === "em" || token.type === "codespan") return [new TextRun({ text: token.text, bold: token.type === "strong", italics: token.type === "em" })]
      if (token.type === "br") return [new TextRun({ break: 1 })]
      if ("tokens" in token) return runs(token.tokens as Token[], "text" in token ? String(token.text) : "")
      return [new TextRun("text" in token ? String(token.text) : "")]
    })
  }
  const children: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = []
  function renderList(list:Tokens.List,level=0):void {
    list.items.forEach((item,i)=>{
      let first=true
      for(const token of item.tokens??marked.lexer(item.text)) {
        if(token.type==='list') {renderList(token as Tokens.List,level+1);continue}
        if(!('text' in token))continue
        const prefix=first?(list.ordered?`${Number(list.start)+i}. `:'• '):''
        children.push(new Paragraph({children:[new TextRun(prefix),...runs('tokens' in token?token.tokens as Token[]:undefined,String(token.text))],
          indent:{left:level*360},spacing:{after:100}}))
        first=false
      }
    })
  }
  const headings = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6]
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading") children.push(new Paragraph({ children: runs(token.tokens, token.text), heading: headings[token.depth - 1], spacing: { before: 260, after: 120 }, keepNext: true }))
    else if (token.type === "table") {
      const row = (cells: Tokens.TableCell[], header: boolean) => new TableRow({ tableHeader: header, children: cells.map(cell => new TableCell({
        shading: header ? { fill: "EEF2FF" } : undefined,
        children: [new Paragraph({ children: runs(cell.tokens, cell.text), spacing: { after: 70 } })],
      })) })
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [row(token.header, true), ...token.rows.map((cells: Tokens.TableCell[]) => row(cells, false))] }))
    } else if (token.type === "list") renderList(token as Tokens.List)
    else if (token.type === "code") token.text.split("\n").forEach((text: string) => children.push(new Paragraph({ children: [new TextRun({ text, font: "Consolas", size: 18 })] })))
    else if ("text" in token) children.push(new Paragraph({ children: runs("tokens" in token ? token.tokens as Token[] : undefined, String(token.text)), spacing: { after: 140, line: 330 } }))
  }
  const document = new Document({ creator: "爱管理", title, description: "基于项目记录生成的项目管理成果",
    styles: { default: { document: { run: { font: { ascii: "Calibri", eastAsia: "Microsoft YaHei", hAnsi: "Calibri" }, size: 22 } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: title, size: 18, color: "64748B" })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT] })] })] }) }, children }] })
  const name = safeMaterialFilename(title)
  const { default: DOMPurify } = await import("dompurify")
  const html = DOMPurify.sanitize(await marked.parse(markdown), { USE_PROFILES: { html: true }, FORBID_TAGS: ["img", "iframe", "form"], FORBID_ATTR: ["style"] })
  const printable = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escape(title)}</title><style>body{font:16px/1.8 'Microsoft YaHei',sans-serif;max-width:900px;margin:40px auto;padding:0 28px;color:#172033}h1,h2,h3{line-height:1.4;break-after:avoid}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #ccd2dc;padding:8px;text-align:left}th{background:#eef2ff}pre{white-space:pre-wrap}a{color:#4338ca}@page{size:A4;margin:20mm}@media print{body{margin:0;padding:0}tr{break-inside:avoid}}</style><body>${html}</body></html>`
  return [
    { name: `${name}.docx`, blob: await Packer.toBlob(document), sourceText: markdown },
    { name: `${name}.md`, blob: new Blob([markdown], { type: "text/markdown;charset=utf-8" }), sourceText: markdown },
    { name: `${name}.html`, blob: new Blob([printable], { type: "text/html;charset=utf-8" }), sourceText: markdown },
  ]
}

export async function spreadsheetFiles(artifact: Extract<MaterialArtifact, { kind: "spreadsheet" }>): Promise<GeneratedMaterialFile[]> {
  const XLSX = await import("xlsx")
  const workbook = XLSX.utils.book_new()
  const used = new Set<string>()
  for (const sheet of artifact.sheets) {
    let name = sheet.name.replace(/[\\/?*\[\]:]/g, "-").slice(0, 26) || "工作表"
    const base = name
    let index = 2
    while (used.has(name.toLowerCase())) name = `${base}-${index++}`
    used.add(name.toLowerCase())
    const ws = XLSX.utils.aoa_to_sheet([sheet.columns, ...sheet.rows])
    ws["!cols"] = sheet.columns.map((_, column) => ({ wch: Math.min(55, Math.max(14, ...[sheet.columns, ...sheet.rows.slice(0, 100)].map(row => String(row[column] ?? "").length * 1.5))) }))
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: sheet.rows.length, c: sheet.columns.length - 1 } }) }
    XLSX.utils.book_append_sheet(workbook, ws, name)
  }
  return [{ name: `${safeMaterialFilename(artifact.title)}.xlsx`, blob: new Blob([XLSX.write(workbook, { type: "array", bookType: "xlsx" })],
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), sourceText: JSON.stringify(artifact) }]
}
