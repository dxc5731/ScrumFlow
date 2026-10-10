import { z } from "zod"
import { analyzeMeetingRequest } from "./meetingRequest"

const title = z.string().trim().min(1).max(120)
const sheet = z.object({ name: title, columns: z.array(z.string().max(200)).min(1).max(40),
  rows: z.array(z.array(z.union([z.string().max(6000), z.number().finite(), z.boolean(), z.null()])).max(40)).max(1500),
}).refine(value => value.rows.every(row => row.length === value.columns.length), "工作表每行须与表头列数一致")
export const materialBundleSchema = z.object({
  title, summary: z.string().min(1).max(6000),
  artifacts: z.array(z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("document"), title, markdown: z.string().min(20).max(120000) }),
    z.object({ kind: z.literal("diagram"), title, mermaid: z.string().min(10).max(40000) }),
    z.object({ kind: z.literal("spreadsheet"), title, sheets: z.array(sheet).min(1).max(15) }),
  ])).min(1).max(8),
})
export type MaterialArtifact = z.infer<typeof materialBundleSchema>["artifacts"][number]
export type MaterialBundle = z.infer<typeof materialBundleSchema>

export function isMaterialRequest(question: string): boolean {
  question = analyzeMeetingRequest(question).commandText
  return /(?:生成|制作|整理|导出|下载|写|画|绘制|展示|看看|给我看|修改|完善|补充|准备)[\s\S]{0,60}(?:UML|甘特图|用户地图|故事地图|旅程图|用例图|类图|时序图|顺序图|活动图|状态图|部署图|组件图|ER图|WBS|文档|纪要|报告|说明书|章程|成果|材料|Excel|Word|PDF|表格|台账|登记册|RACI|测试计划|验收计划|总结表|预算表|工作量表|行动项清单|变更摘要)/i.test(question) ||
    /^(?:请)?(?:UML|甘特图|用户地图|用户故事地图|用例图|时序图|类图|Excel|Word|需求说明书|项目章程|成果包)[。！？?！\s]*$/i.test(question)
}

export function isMaterialFollowUp(question: string): boolean {
  question = analyzeMeetingRequest(question).commandText
  return /(?:这份|这张|刚才.*(?:图|文档|材料)).*(?:改|补充|完善|生成)|(?:改成|修改|更改|调整).*(?:标题|格式|颜色|章节)|补充.*章节|再具体|继续完善|重新生成/.test(question)
}

export function safeMaterialFilename(title: string): string {
  const name = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/[. ]+$/g, "").slice(0, 90)
  return /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(name) ? `成果-${name}` : name || "项目成果"
}

export function validateDiagramSource(source: string, diagramTitle = ""): string {
  let clean = source.trim().replace(/^```(?:mermaid)?\s*|\s*```$/g, "").trim()
  // Mermaid's native usecase dialect places include/extend inside the operator.
  // Normalize common UML spelling without paying a model to repair known syntax.
  if (/^usecase-beta\b/.test(clean)) clean = clean.replace(/^(\s*\w+)\s*\.\.>\s*(\w+)\s*:\s*(?:<<|«)?(include|extend)(?:>>|»)?\s*$/gmi, "$1 ..>: $3 $2")
  if (!/^(?:usecase-beta|flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|journey|mindmap|requirementDiagram|pie|gitGraph|timeline|quadrantChart)\b/.test(clean)) throw new Error("图表类型不受支持，请重新生成 Mermaid 图")
  if (/%%\{|^\s*click\s|<\s*(?:script|iframe|img|object|foreignObject|style)|(?:javascript|https?|data):|url\s*\(|\bimg\s*:/im.test(clean)) throw new Error("图表包含不支持的脚本、链接或外部资源，请重新生成")
  if (/用例图|use[ -]?case/i.test(diagramTitle) && !/^usecase-beta\b/.test(clean)) throw new Error("用例图须使用 usecase-beta 的原生参与者、椭圆用例和系统边界，不能用普通矩形流程图代替")
  // Gantt's lexer treats a task title starting with a reserved keyword as a directive.
  // Preserve the actual title while disambiguating labels such as “Gantt 支持 WBS 导入”.
  return /^gantt\b/.test(clean) ? clean.split("\n").map((line, index) => index > 0 && /^\s*(?:gantt|title|section|dateFormat|axisFormat|excludes|includes|todayMarker)\b[^:]*:/i.test(line)
    ? line.replace(/^(\s*)/, "$1工作项 · ") : line).join("\n") : clean
}
