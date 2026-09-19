import type {
  UmlDiagramData,
  UmlDiagramKind,
  UmlEdgeEntity,
  UmlNodeEntity,
  UmlNodeKind,
  UmlRelationType,
} from "../types"

export const UML_PLANTUML_TEMPLATES: Record<UmlDiagramKind, string> = {
  "use-case": `@startuml
left to right direction
actor "PO" as PO
usecase "维护 Product Backlog" as UC1
PO --> UC1
@enduml`,
  sequence: `@startuml
participant "PO" as PO
participant "系统" as System
participant "项目模型" as Model
PO -> System : 更新 Story
System -> Model : 保存变更
Model --> PO : 返回影响分析
@enduml`,
  class: `@startuml
class "Project" as Project {
  - name: string
  - goal: string
}
class "Story" as Story {
  - title: string
}
Project "1" *-- "*" Story
@enduml`,
}

export interface UmlParseResult {
  diagram: UmlDiagramData
  warnings: string[]
}

export type UmlEndpointDecoration =
  | "open-arrow"
  | "closed-arrow"
  | "hollow-triangle"
  | "hollow-diamond"
  | "filled-diamond"
  | "none"

export function getUmlRelationVisual(relation: UmlRelationType): {
  dashed: boolean
  start: UmlEndpointDecoration
  end: UmlEndpointDecoration
} {
  if (relation === "generalization")
    return { dashed: false, start: "none", end: "hollow-triangle" }
  if (relation === "realization")
    return { dashed: true, start: "none", end: "hollow-triangle" }
  if (relation === "composition")
    return { dashed: false, start: "filled-diamond", end: "none" }
  if (relation === "aggregation")
    return { dashed: false, start: "hollow-diamond", end: "none" }
  if (relation === "message")
    return { dashed: false, start: "none", end: "closed-arrow" }
  if (relation === "return")
    return { dashed: true, start: "none", end: "open-arrow" }
  return {
    dashed: relation === "dependency" || relation === "include" || relation === "extend",
    start: "none",
    end: "open-arrow",
  }
}

export function inferUmlEdgeHandles(
  diagram: UmlDiagramData,
  edge: UmlEdgeEntity,
): Pick<UmlEdgeEntity, "sourceHandle" | "targetHandle"> {
  if (edge.sourceHandle && edge.targetHandle) {
    return { sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle }
  }
  const source = diagram.nodes.find((node) => node.id === edge.source)
  const target = diagram.nodes.find((node) => node.id === edge.target)
  if (!source || !target) return { sourceHandle: "right", targetHandle: "left" }

  const deltaX = target.x - source.x
  const deltaY = target.y - source.y
  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    return deltaX >= 0
      ? { sourceHandle: "right", targetHandle: "left" }
      : { sourceHandle: "left", targetHandle: "right" }
  }
  return deltaY >= 0
    ? { sourceHandle: "bottom", targetHandle: "top" }
    : { sourceHandle: "top", targetHandle: "bottom" }
}

const hash = (value: string) => {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return (result >>> 0).toString(36)
}

const cleanLabel = (value: string) =>
  value
    .trim()
    .replace(/^"|"$/g, "")
    .replace(/^\(|\)$/g, "")
    .trim()

const cleanReference = (value: string) =>
  cleanLabel(
    value
      .trim()
      .replace(/\s+"[^"]*"\s*$/, "")
      .replace(/^"[^"]*"\s+/, ""),
  )

const relationFromArrow = (
  arrow: string,
  label: string,
): { relation: UmlRelationType; reverse: boolean } => {
  const normalizedLabel = label.toLowerCase()
  if (normalizedLabel.includes("<<include>>"))
    return { relation: "include", reverse: false }
  if (normalizedLabel.includes("<<extend>>"))
    return { relation: "extend", reverse: false }
  if (arrow === "<|--") return { relation: "generalization", reverse: true }
  if (arrow === "--|>") return { relation: "generalization", reverse: false }
  if (arrow === "<|..") return { relation: "realization", reverse: true }
  if (arrow === "..|>") return { relation: "realization", reverse: false }
  if (arrow === "o--") return { relation: "aggregation", reverse: false }
  if (arrow === "--o") return { relation: "aggregation", reverse: true }
  if (arrow === "*--") return { relation: "composition", reverse: false }
  if (arrow === "--*") return { relation: "composition", reverse: true }
  if (arrow === "<..") return { relation: "dependency", reverse: true }
  if (arrow === "..>") return { relation: "dependency", reverse: false }
  return { relation: "association", reverse: arrow === "<--" }
}

const defaultNodeKind = (kind: UmlDiagramKind): UmlNodeKind =>
  kind === "class" ? "class" : kind === "sequence" ? "participant" : "use-case"

export function createEmptyUmlDiagram(kind: UmlDiagramKind): UmlDiagramData {
  return {
    version: 1,
    kind,
    sourceFormat: "plantuml",
    nodes: [],
    edges: [],
  }
}

function layoutNodes(kind: UmlDiagramKind, nodes: UmlNodeEntity[]) {
  let actorIndex = 0
  let primaryIndex = 0
  return nodes.map((node, index) => {
    if (kind === "sequence")
      return { ...node, x: 70 + index * 190, y: 48 }
    if (kind === "use-case" && node.kind === "actor") {
      const positioned = { ...node, x: 60, y: 80 + actorIndex * 170 }
      actorIndex += 1
      return positioned
    }
    const positioned = {
      ...node,
      x: kind === "class" ? 80 + (primaryIndex % 3) * 260 : 400,
      y:
        kind === "class"
          ? 70 + Math.floor(primaryIndex / 3) * 190
          : 70 + primaryIndex * 120,
    }
    primaryIndex += 1
    return positioned
  })
}

export function parseUmlSource(
  kind: UmlDiagramKind,
  source: string,
  previous?: UmlDiagramData,
): UmlParseResult {
  const diagram = createEmptyUmlDiagram(kind)
  const warnings: string[] = []
  const aliases = new Map<string, string>()
  const nodes = new Map<string, UmlNodeEntity>()
  const previousByLabel = new Map(
    (previous?.kind === kind ? previous.nodes : []).map((node) => [
      `${node.kind}:${node.label.toLowerCase()}`,
      node,
    ]),
  )

  const ensureNode = (reference: string, label: string, nodeKind: UmlNodeKind) => {
    const cleanRef = cleanReference(reference) || cleanLabel(label)
    const clean = cleanLabel(label) || cleanRef
    const aliasKey = cleanRef.toLowerCase()
    const knownId = aliases.get(aliasKey) ?? aliases.get(clean.toLowerCase())
    if (knownId && nodes.has(knownId)) return nodes.get(knownId)!
    const previousNode = previousByLabel.get(`${nodeKind}:${clean.toLowerCase()}`)
    const baseId = previousNode?.id ?? `uml-${hash(`${nodeKind}:${cleanRef || clean}`)}`
    let id = baseId
    let suffix = 2
    while (nodes.has(id)) {
      id = `${baseId}-${suffix}`
      suffix += 1
    }
    const node: UmlNodeEntity = {
      id,
      kind: nodeKind,
      label: clean || "未命名节点",
      x: previousNode?.x ?? 0,
      y: previousNode?.y ?? 0,
      details: previousNode?.details ? [...previousNode.details] : [],
    }
    nodes.set(id, node)
    aliases.set(aliasKey, id)
    aliases.set(clean.toLowerCase(), id)
    return node
  }

  const lines = source.split(/\r?\n/)
  let currentClass: UmlNodeEntity | null = null
  let edgeOrder = 0
  lines.forEach((rawLine, lineIndex) => {
    const line = rawLine.trim()
    if (!line || line.startsWith("'") || line.startsWith("//")) return
    if (/^@(start|end)uml$/i.test(line)) return
    if (/^(left to right direction|top to bottom direction|skinparam\b|title\b|hide\b|show\b)/i.test(line)) return
    if (/^(package|rectangle|namespace)\b.*\{$/i.test(line) || line === "}") {
      if (line === "}" && currentClass) currentClass = null
      return
    }

    const actorZh = line.match(/^参与者\s*:\s*(.+)$/)
    if (actorZh) {
      ensureNode(actorZh[1], actorZh[1], "actor")
      currentClass = null
      return
    }
    const useCaseZh = line.match(/^用例\s*:\s*(.+)$/)
    if (useCaseZh) {
      ensureNode(useCaseZh[1], useCaseZh[1], "use-case")
      currentClass = null
      return
    }

    const actor = line.match(/^actor\s+(?:"([^"]+)"|([^\s]+))(?:\s+as\s+([\w.-]+))?/i)
    if (actor) {
      const label = actor[1] ?? actor[2]
      ensureNode(actor[3] ?? label, label, "actor")
      currentClass = null
      return
    }
    const participant = line.match(/^(?:participant|boundary|control|entity|database)\s+(?:"([^"]+)"|([^\s]+))(?:\s+as\s+([\w.-]+))?/i)
    if (participant) {
      const label = participant[1] ?? participant[2]
      ensureNode(participant[3] ?? label, label, "participant")
      currentClass = null
      return
    }
    const useCase = line.match(/^usecase\s+(?:"([^"]+)"|\(([^)]+)\)|([^\s]+))(?:\s+as\s+([\w.-]+))?/i)
      ?? line.match(/^\(([^)]+)\)(?:\s+as\s+([\w.-]+))?$/)
    if (useCase && kind === "use-case") {
      const label = useCase[1] ?? useCase[2] ?? useCase[3]
      const alias = useCase[4] ?? useCase[2] ?? label
      ensureNode(alias, label, "use-case")
      currentClass = null
      return
    }

    const classMatch = line.match(/^class\s+(?:"([^"]+)"|([^\s{]+))(?:\s+as\s+([\w.-]+))?\s*(\{)?/i)
    if (classMatch && kind === "class") {
      const label = classMatch[1] ?? classMatch[2]
      currentClass = ensureNode(classMatch[3] ?? label, label, "class")
      return
    }
    if (kind === "class" && currentClass && /^[+#~-]/.test(line)) {
      const detail = line.replace(/\s*\}$/, "").trim()
      if (detail) currentClass.details.push(detail)
      if (line.endsWith("}")) currentClass = null
      return
    }

    if (kind === "sequence") {
      const message = line.match(/^(.+?)\s*(-{1,2}>+|<{1,2}-{1,2})\s*(.+?)(?:\s*:\s*(.*))?$/)
      if (message) {
        let sourceRef = cleanReference(message[1])
        let targetRef = cleanReference(message[3])
        let relation: UmlRelationType = message[2].startsWith("<") ? "return" : message[2].startsWith("--") ? "return" : "message"
        if (message[2].startsWith("<")) {
          const previousSource = sourceRef
          sourceRef = targetRef
          targetRef = previousSource
        }
        const sourceNode = ensureNode(sourceRef, sourceRef, "participant")
        const targetNode = ensureNode(targetRef, targetRef, "participant")
        diagram.edges.push({
          id: `edge-${hash(`${lineIndex}:${line}`)}`,
          source: sourceNode.id,
          target: targetNode.id,
          relation,
          label: (message[4] ?? "消息").trim(),
          order: edgeOrder++,
        })
        currentClass = null
        return
      }
    } else {
      const relationMatch = line.match(/^(.+?)\s*(<\|--|--\|>|<\|\.\.|\.\.\|>|o--|--o|\*--|--\*|\.\.>|<\.\.|-->|<--|--)\s*(.+?)(?:\s*:\s*(.*))?$/)
      if (relationMatch) {
        let sourceRef = cleanReference(relationMatch[1])
        let targetRef = cleanReference(relationMatch[3])
        const label = (relationMatch[4] ?? "").trim()
        const relationInfo = relationFromArrow(relationMatch[2], label)
        if (relationInfo.reverse) {
          const previousSource = sourceRef
          sourceRef = targetRef
          targetRef = previousSource
        }
        const sourceNode = ensureNode(sourceRef, sourceRef, defaultNodeKind(kind))
        const targetNode = ensureNode(targetRef, targetRef, defaultNodeKind(kind))
        diagram.edges.push({
          id: `edge-${hash(`${lineIndex}:${line}`)}`,
          source: sourceNode.id,
          target: targetNode.id,
          relation: relationInfo.relation,
          label: label.replace(/<<(?:include|extend)>>/gi, "").trim(),
          order: edgeOrder++,
        })
        currentClass = null
        return
      }
    }

    if (line !== "{" && line !== "}") warnings.push(`第 ${lineIndex + 1} 行暂未识别：${line}`)
  })

  diagram.nodes = layoutNodes(kind, [...nodes.values()]).map((node) => {
    const previousNode = previousByLabel.get(`${node.kind}:${node.label.toLowerCase()}`)
    return previousNode ? { ...node, x: previousNode.x, y: previousNode.y } : node
  })
  if (previous?.kind === kind) {
    const usedPreviousEdges = new Set<string>()
    diagram.edges = diagram.edges.map((edge) => {
      const matching = previous.edges.find((candidate) =>
        !usedPreviousEdges.has(candidate.id) &&
        candidate.source === edge.source &&
        candidate.target === edge.target &&
        candidate.relation === edge.relation &&
        candidate.label === edge.label,
      )
      if (!matching) return edge
      usedPreviousEdges.add(matching.id)
      return {
        ...edge,
        id: matching.id,
        sourceHandle: matching.sourceHandle,
        targetHandle: matching.targetHandle,
      }
    })
  }
  return { diagram, warnings }
}

const quote = (value: string) => `"${value.replace(/"/g, "\\\"")}"`

export function generatePlantUml(diagram: UmlDiagramData) {
  const aliases = new Map(diagram.nodes.map((node, index) => [node.id, `N${index + 1}`]))
  const lines = ["@startuml"]
  if (diagram.kind === "use-case") lines.push("left to right direction")
  diagram.nodes.forEach((node) => {
    const alias = aliases.get(node.id)!
    if (node.kind === "actor") lines.push(`actor ${quote(node.label)} as ${alias}`)
    else if (node.kind === "use-case") lines.push(`usecase ${quote(node.label)} as ${alias}`)
    else if (node.kind === "participant") lines.push(`participant ${quote(node.label)} as ${alias}`)
    else {
      lines.push(`class ${quote(node.label)} as ${alias} {`)
      node.details.forEach((detail) => lines.push(`  ${detail}`))
      lines.push("}")
    }
  })
  ;[...diagram.edges]
    .sort((a, b) => a.order - b.order)
    .forEach((edge) => {
      const source = aliases.get(edge.source)
      const target = aliases.get(edge.target)
      if (!source || !target) return
      if (diagram.kind === "sequence") {
        const arrow = edge.relation === "return" ? "-->" : "->"
        lines.push(`${source} ${arrow} ${target}${edge.label ? ` : ${edge.label}` : ""}`)
        return
      }
      const arrow =
        edge.relation === "generalization"
          ? "--|>"
          : edge.relation === "realization"
            ? "..|>"
          : edge.relation === "aggregation"
            ? "o--"
            : edge.relation === "composition"
              ? "*--"
              : edge.relation === "dependency" || edge.relation === "include" || edge.relation === "extend"
                ? "..>"
                : "-->"
      const stereotype = edge.relation === "include" ? "<<include>>" : edge.relation === "extend" ? "<<extend>>" : ""
      const label = [stereotype, edge.label].filter(Boolean).join(" ")
      lines.push(`${source} ${arrow} ${target}${label ? ` : ${label}` : ""}`)
    })
  lines.push("@enduml")
  return lines.join("\n")
}

const escapeXml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

export function umlDiagramToSvg(diagram: UmlDiagramData, title: string) {
  const nodeSize = (node: UmlNodeEntity) => ({
    width: node.kind === "use-case" ? 210 : node.kind === "actor" ? 120 : 200,
    height: node.kind === "class" ? Math.max(86, 54 + node.details.length * 18) : node.kind === "participant" ? 56 : 90,
  })
  const maxX = Math.max(760, ...diagram.nodes.map((node) => node.x + nodeSize(node).width + 80))
  const maxY = Math.max(480, ...diagram.nodes.map((node) => node.y + nodeSize(node).height + 100))
  const nodeById = new Map(diagram.nodes.map((node) => [node.id, node]))
  const edges = diagram.edges.map((edge) => {
    const source = nodeById.get(edge.source)
    const target = nodeById.get(edge.target)
    if (!source || !target) return ""
    const sourceSize = nodeSize(source)
    const targetSize = nodeSize(target)
    const handles = inferUmlEdgeHandles(diagram, edge)
    const anchor = (node: UmlNodeEntity, width: number, height: number, handle: UmlEdgeEntity["sourceHandle"]) => {
      if (handle === "left") return { x: node.x, y: node.y + height / 2 }
      if (handle === "right") return { x: node.x + width, y: node.y + height / 2 }
      if (handle === "top") return { x: node.x + width / 2, y: node.y }
      return { x: node.x + width / 2, y: node.y + height }
    }
    const sourcePoint = diagram.kind === "sequence"
      ? { x: source.x + sourceSize.width / 2, y: source.y + 86 + edge.order * 46 }
      : anchor(source, sourceSize.width, sourceSize.height, handles.sourceHandle)
    const targetPoint = diagram.kind === "sequence"
      ? { x: target.x + targetSize.width / 2, y: target.y + 86 + edge.order * 46 }
      : anchor(target, targetSize.width, targetSize.height, handles.targetHandle)
    const visual = getUmlRelationVisual(edge.relation)
    const dash = visual.dashed ? ' stroke-dasharray="6 4"' : ""
    const markerStart = visual.start === "filled-diamond"
      ? ' marker-start="url(#filled-diamond)"'
      : visual.start === "hollow-diamond"
        ? ' marker-start="url(#hollow-diamond)"'
        : ""
    const markerEnd = visual.end === "closed-arrow"
      ? ' marker-end="url(#closed-arrow)"'
      : visual.end === "hollow-triangle"
        ? ' marker-end="url(#hollow-triangle)"'
        : visual.end === "open-arrow"
          ? ' marker-end="url(#open-arrow)"'
          : ""
    return `<g><line x1="${sourcePoint.x}" y1="${sourcePoint.y}" x2="${targetPoint.x}" y2="${targetPoint.y}" stroke="#667085" stroke-width="1.5"${markerStart}${markerEnd}${dash}/>${edge.label ? `<text x="${(sourcePoint.x + targetPoint.x) / 2}" y="${(sourcePoint.y + targetPoint.y) / 2 - 7}" text-anchor="middle" font-size="11" fill="#475467">${escapeXml(edge.label)}</text>` : ""}</g>`
  }).join("")
  const nodes = diagram.nodes.map((node) => {
    const { width, height } = nodeSize(node)
    if (node.kind === "actor") {
      const cx = node.x + width / 2
      return `<g><circle cx="${cx}" cy="${node.y + 18}" r="12" fill="white" stroke="#475467"/><line x1="${cx}" y1="${node.y + 30}" x2="${cx}" y2="${node.y + 58}" stroke="#475467"/><line x1="${cx - 20}" y1="${node.y + 40}" x2="${cx + 20}" y2="${node.y + 40}" stroke="#475467"/><line x1="${cx}" y1="${node.y + 58}" x2="${cx - 16}" y2="${node.y + 78}" stroke="#475467"/><line x1="${cx}" y1="${node.y + 58}" x2="${cx + 16}" y2="${node.y + 78}" stroke="#475467"/><text x="${cx}" y="${node.y + 98}" text-anchor="middle" font-size="12" fill="#344054">${escapeXml(node.label)}</text></g>`
    }
    if (node.kind === "use-case") return `<g><ellipse cx="${node.x + width / 2}" cy="${node.y + height / 2}" rx="${width / 2}" ry="${height / 2}" fill="white" stroke="#475467"/><text x="${node.x + width / 2}" y="${node.y + height / 2 + 4}" text-anchor="middle" font-size="12" fill="#344054">${escapeXml(node.label)}</text></g>`
    const details = node.details.map((detail, index) => `<text x="${node.x + 10}" y="${node.y + 58 + index * 18}" font-size="10" fill="#475467">${escapeXml(detail)}</text>`).join("")
    return `<g><rect x="${node.x}" y="${node.y}" width="${width}" height="${height}" rx="4" fill="white" stroke="#475467"/><text x="${node.x + width / 2}" y="${node.y + 24}" text-anchor="middle" font-size="12" font-weight="600" fill="#172033">${escapeXml(node.label)}</text>${node.kind === "class" ? `<line x1="${node.x}" y1="${node.y + 36}" x2="${node.x + width}" y2="${node.y + 36}" stroke="#98A2B3"/>${details}` : ""}</g>`
  }).join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${maxX}" height="${maxY}" viewBox="0 0 ${maxX} ${maxY}"><rect width="100%" height="100%" fill="#F8FAFC"/><text x="24" y="30" font-family="Arial, sans-serif" font-size="15" font-weight="600" fill="#172033">${escapeXml(title)}</text><defs><marker id="open-arrow" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto"><path d="M1,1 L9,5 L1,9" fill="none" stroke="#667085" stroke-width="1.4"/></marker><marker id="closed-arrow" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto"><path d="M1,1 L9,5 L1,9 Z" fill="#667085" stroke="#667085"/></marker><marker id="hollow-triangle" markerWidth="12" markerHeight="12" refX="11" refY="6" orient="auto"><path d="M1,1 L11,6 L1,11 Z" fill="white" stroke="#667085" stroke-width="1.3"/></marker><marker id="hollow-diamond" markerWidth="14" markerHeight="12" refX="1" refY="6" orient="auto"><path d="M1,6 L7,1 L13,6 L7,11 Z" fill="white" stroke="#667085" stroke-width="1.3"/></marker><marker id="filled-diamond" markerWidth="14" markerHeight="12" refX="1" refY="6" orient="auto"><path d="M1,6 L7,1 L13,6 L7,11 Z" fill="#667085" stroke="#667085"/></marker></defs><g font-family="Arial, Microsoft YaHei, sans-serif">${edges}${nodes}</g></svg>`
}
