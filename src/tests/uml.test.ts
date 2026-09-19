import { describe, expect, it } from "vitest"
import { createDemoProjectState } from "../data/demoProject"
import {
  UML_PLANTUML_TEMPLATES,
  generatePlantUml,
  getUmlRelationVisual,
  inferUmlEdgeHandles,
  parseUmlSource,
  umlDiagramToSvg,
} from "../utils/uml"

describe("UML code and visual-model conversion", () => {
  it("ships substantial default UML examples for every supported diagram kind", () => {
    const demo = createDemoProjectState()
    const umlAssets = Object.values(demo.assets).filter((asset) => asset.umlData)
    expect(umlAssets.map((asset) => asset.kind)).toEqual(
      expect.arrayContaining(["use-case", "sequence", "class"]),
    )
    expect(umlAssets.every((asset) => (asset.umlData?.nodes.length ?? 0) >= 5)).toBe(true)
    const classDiagram = umlAssets.find((asset) => asset.kind === "class")?.umlData
    expect(new Set(classDiagram?.edges.map((edge) => edge.relation))).toEqual(
      new Set(["composition", "aggregation", "generalization", "association", "dependency", "realization"]),
    )
    const sequence = umlAssets.find((asset) => asset.kind === "sequence")?.umlData
    const nodeIndex = new Map(sequence?.nodes.map((node, index) => [node.id, index]))
    expect(sequence?.edges.some((edge) =>
      (nodeIndex.get(edge.source) ?? 0) > (nodeIndex.get(edge.target) ?? 0),
    )).toBe(true)
  })

  it("parses and regenerates use-case nodes and UML relations", () => {
    const source = `@startuml
actor "产品负责人" as PO
usecase "维护需求" as UC1
usecase "检查完整性" as UC2
PO --> UC1
UC1 ..> UC2 : <<include>>
@enduml`
    const parsed = parseUmlSource("use-case", source)
    expect(parsed.warnings).toEqual([])
    expect(parsed.diagram.nodes).toHaveLength(3)
    expect(parsed.diagram.edges.map((edge) => edge.relation)).toEqual(["association", "include"])
    const roundTrip = parseUmlSource("use-case", generatePlantUml(parsed.diagram))
    expect(roundTrip.diagram.nodes).toHaveLength(3)
    expect(roundTrip.diagram.edges.map((edge) => edge.relation)).toEqual(["association", "include"])
  })

  it("keeps class members, class relations and visual positions", () => {
    const parsed = parseUmlSource("class", UML_PLANTUML_TEMPLATES.class)
    expect(parsed.diagram.nodes).toHaveLength(2)
    expect(parsed.diagram.nodes[0].details).toEqual(["- name: string", "- goal: string"])
    expect(parsed.diagram.edges[0].relation).toBe("composition")
    const moved = {
      ...parsed.diagram,
      nodes: parsed.diagram.nodes.map((node, index) => ({ ...node, x: 120 + index * 300, y: 160 })),
    }
    const reparsed = parseUmlSource("class", generatePlantUml(moved), moved)
    expect(reparsed.diagram.nodes.map((node) => [node.x, node.y])).toEqual([[120, 160], [420, 160]])
  })

  it("orders sequence messages and exports nodes with edges to SVG", () => {
    const parsed = parseUmlSource("sequence", UML_PLANTUML_TEMPLATES.sequence)
    expect(parsed.diagram.nodes).toHaveLength(3)
    expect(parsed.diagram.edges).toHaveLength(3)
    expect(parsed.diagram.edges.at(-1)?.relation).toBe("return")
    const svg = umlDiagramToSvg(parsed.diagram, "项目时序")
    expect(svg).toContain("项目时序")
    expect(svg).toContain("marker-end")
    expect(svg).toContain("返回影响分析")
  })

  it("infers geometry handles without changing the semantic arrow direction", () => {
    const parsed = parseUmlSource("use-case", UML_PLANTUML_TEMPLATES["use-case"])
    const [source, target] = parsed.diagram.nodes
    const edge = parsed.diagram.edges[0]
    source.x = 520
    source.y = 80
    target.x = 100
    target.y = 80

    expect(inferUmlEdgeHandles(parsed.diagram, edge)).toEqual({
      sourceHandle: "left",
      targetHandle: "right",
    })
    expect(edge.source).toBe(source.id)
    expect(edge.target).toBe(target.id)
  })

  it("preserves explicitly selected handles when PlantUML is applied again", () => {
    const parsed = parseUmlSource("use-case", UML_PLANTUML_TEMPLATES["use-case"])
    parsed.diagram.edges[0] = {
      ...parsed.diagram.edges[0],
      sourceHandle: "bottom",
      targetHandle: "top",
    }

    const reparsed = parseUmlSource(
      "use-case",
      generatePlantUml(parsed.diagram),
      parsed.diagram,
    )
    expect(reparsed.diagram.edges[0]).toMatchObject({
      source: parsed.diagram.edges[0].source,
      target: parsed.diagram.edges[0].target,
      sourceHandle: "bottom",
      targetHandle: "top",
    })
  })

  it("uses distinct standard notation for every class relation", () => {
    const relations = [
      "generalization",
      "realization",
      "composition",
      "aggregation",
      "association",
      "dependency",
    ] as const
    const visuals = relations.map((relation) => getUmlRelationVisual(relation))
    expect(new Set(visuals.map((visual) => JSON.stringify(visual))).size).toBe(relations.length)
    expect(getUmlRelationVisual("generalization")).toEqual({
      dashed: false,
      start: "none",
      end: "hollow-triangle",
    })
    expect(getUmlRelationVisual("composition").start).toBe("filled-diamond")
    expect(getUmlRelationVisual("aggregation").start).toBe("hollow-diamond")
    expect(getUmlRelationVisual("dependency")).toMatchObject({ dashed: true, end: "open-arrow" })
  })

  it("round-trips class realization and exports a hollow triangle", () => {
    const parsed = parseUmlSource("class", `@startuml
class "实现类" as Concrete
class "接口" as Contract
Concrete ..|> Contract
@enduml`)
    expect(parsed.diagram.edges[0].relation).toBe("realization")
    expect(generatePlantUml(parsed.diagram)).toContain("..|>")
    expect(umlDiagramToSvg(parsed.diagram, "实现关系")).toContain('marker-end="url(#hollow-triangle)"')
  })

  it("exports a right-to-left sequence message with its arrow on the left target", () => {
    const parsed = parseUmlSource("sequence", `@startuml
participant "左侧" as Left
participant "右侧" as Right
Right -> Left : 向左消息
@enduml`)
    const svg = umlDiagramToSvg(parsed.diagram, "左向时序")
    expect(svg).toMatch(/x1="360"[^>]+x2="170"[^>]+marker-end="url\(#closed-arrow\)"/)
  })
})
