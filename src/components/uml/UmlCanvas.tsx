import { useEffect, useMemo, useState } from "react"
import type { RefObject } from "react"
import { toBlob } from "html-to-image"
import {
  Background,
  BaseEdge,
  ConnectionMode,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  getSmoothStepPath,
  getStraightPath,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react"
import { Box, CircleUserRound, Plus, Trash2 } from "lucide-react"
import type {
  UmlDiagramData,
  UmlEdgeEntity,
  UmlNodeEntity,
  UmlNodeKind,
  UmlRelationType,
} from "../../types"
import { getUmlRelationVisual, inferUmlEdgeHandles } from "../../utils/uml"

type CanvasNodeData = {
  nodeKind: UmlNodeKind
  label: string
  details: string[]
  sequencePorts: Array<{ id: string; order: number }>
  sequenceNewOrder: number
  sequenceHeight: number
}

type CanvasNode = Node<CanvasNodeData, "umlNode">

const HANDLES = (
  <>
    <Handle type="source" position={Position.Left} id="left" />
    <Handle type="source" position={Position.Top} id="top" />
    <Handle type="source" position={Position.Right} id="right" />
    <Handle type="source" position={Position.Bottom} id="bottom" />
  </>
)

function UmlNodeCard({ data, selected }: NodeProps<CanvasNode>) {
  if (data.nodeKind === "actor") {
    return (
      <div className={`uml-node uml-actor-node ${selected ? "is-selected" : ""}`}>
        {HANDLES}
        <CircleUserRound size={36} strokeWidth={1.4} />
        <span>{data.label}</span>
      </div>
    )
  }
  if (data.nodeKind === "use-case") {
    return (
      <div className={`uml-node uml-use-case-node ${selected ? "is-selected" : ""}`}>
        {HANDLES}
        <span>{data.label}</span>
      </div>
    )
  }
  if (data.nodeKind === "participant") {
    return (
      <div className={`uml-participant-shell ${selected ? "is-selected" : ""}`} style={{ height: data.sequenceHeight }}>
        <div className="uml-node uml-participant-node">
          <span>{data.label}</span>
        </div>
        <span className="uml-lifeline" />
        {data.sequencePorts.map((port) => (
          <Handle
            className="uml-sequence-port"
            key={port.id}
            id={port.id}
            type="source"
            position={Position.Left}
            style={{ left: "50%", right: "auto", top: 86 + port.order * 46, transform: "translate(-50%, -50%)" }}
          />
        ))}
        <Handle
          className="uml-sequence-port uml-sequence-new-port"
          id="lifeline-new"
          type="source"
          position={Position.Left}
          style={{ left: "50%", right: "auto", top: 86 + data.sequenceNewOrder * 46, transform: "translate(-50%, -50%)" }}
        />
      </div>
    )
  }
  return (
    <div className={`uml-node uml-class-node ${selected ? "is-selected" : ""}`}>
      {HANDLES}
      <div className="uml-class-title"><Box size={13} />{data.label}</div>
      <div className="uml-class-members">
        {data.details.length
          ? data.details.map((detail, index) => <div key={`${detail}-${index}`}>{detail}</div>)
          : <span className="text-[#98A2B3]">无属性或方法</span>}
      </div>
    </div>
  )
}

const nodeTypes = { umlNode: UmlNodeCard }

type UmlCanvasEdgeData = {
  relation: UmlRelationType
  sequence: boolean
}

const edgePoint = (
  x: number,
  y: number,
  angle: number,
  distance: number,
  normal = 0,
) => ({
  x: x + Math.cos(angle) * distance - Math.sin(angle) * normal,
  y: y + Math.sin(angle) * distance + Math.cos(angle) * normal,
})

function UmlDiagramEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    label,
    labelStyle,
    labelBgStyle,
    labelBgPadding,
    selected,
    style,
  } = props
  const data = props.data as UmlCanvasEdgeData
  const visual = getUmlRelationVisual(data.relation)
  const [path, labelX, labelY] = data.sequence
    ? getStraightPath({ sourceX, sourceY, targetX, targetY })
    : getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 8 })
  const color = selected ? "#1570EF" : "#667085"
  const targetAngle = data.sequence
    ? Math.atan2(targetY - sourceY, targetX - sourceX)
    : targetPosition === Position.Left
      ? 0
      : targetPosition === Position.Right
        ? Math.PI
        : targetPosition === Position.Top
          ? Math.PI / 2
          : -Math.PI / 2
  const sourceAngle = data.sequence
    ? targetAngle
    : sourcePosition === Position.Right
      ? 0
      : sourcePosition === Position.Left
        ? Math.PI
        : sourcePosition === Position.Bottom
          ? Math.PI / 2
          : -Math.PI / 2

  const arrow = (closed: boolean) => {
    const tip = { x: targetX, y: targetY }
    const left = edgePoint(targetX, targetY, targetAngle, -11, 4.5)
    const right = edgePoint(targetX, targetY, targetAngle, -11, -4.5)
    return closed
      ? <polygon points={`${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`} fill={color} stroke={color} strokeLinejoin="round" />
      : <polyline points={`${left.x},${left.y} ${tip.x},${tip.y} ${right.x},${right.y}`} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
  }

  const triangle = () => {
    const tip = { x: targetX, y: targetY }
    const left = edgePoint(targetX, targetY, targetAngle, -15, 7)
    const right = edgePoint(targetX, targetY, targetAngle, -15, -7)
    return <polygon points={`${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`} fill="white" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
  }

  const diamond = (filled: boolean) => {
    const near = { x: sourceX, y: sourceY }
    const upper = edgePoint(sourceX, sourceY, sourceAngle, 7, 5)
    const far = edgePoint(sourceX, sourceY, sourceAngle, 14)
    const lower = edgePoint(sourceX, sourceY, sourceAngle, 7, -5)
    return <polygon points={`${near.x},${near.y} ${upper.x},${upper.y} ${far.x},${far.y} ${lower.x},${lower.y}`} fill={filled ? color : "white"} stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
  }

  const decoration = visual.end === "hollow-triangle"
    ? triangle()
    : visual.start === "filled-diamond"
      ? diamond(true)
      : visual.start === "hollow-diamond"
        ? diamond(false)
        : visual.end === "closed-arrow"
          ? arrow(true)
          : arrow(false)

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        label={label}
        labelX={labelX}
        labelY={labelY}
        labelStyle={labelStyle}
        labelBgStyle={labelBgStyle}
        labelBgPadding={labelBgPadding}
        style={{ ...style, stroke: color, strokeWidth: selected ? 2 : style?.strokeWidth }}
      />
      <g className="pointer-events-none">{decoration}</g>
    </>
  )
}

const edgeTypes = { umlEdge: UmlDiagramEdge }

const relationLabel: Record<UmlRelationType, string> = {
  association: "关联",
  dependency: "依赖",
  generalization: "继承",
  realization: "实现",
  aggregation: "聚合",
  composition: "组合",
  include: "Include",
  extend: "Extend",
  message: "消息",
  return: "返回消息",
}

function availableRelations(diagram: UmlDiagramData): UmlRelationType[] {
  if (diagram.kind === "sequence") return ["message", "return"]
  if (diagram.kind === "use-case")
    return ["association", "dependency", "include", "extend", "generalization"]
  return ["association", "dependency", "generalization", "realization", "aggregation", "composition"]
}

function toCanvasNodes(diagram: UmlDiagramData): CanvasNode[] {
  const maxSequenceOrder = Math.max(0, ...diagram.edges.map((edge) => edge.order))
  const sequenceNewOrder = diagram.edges.length ? maxSequenceOrder + 1 : 0
  return diagram.nodes.map((node) => ({
    id: node.id,
    type: "umlNode",
    position: { x: node.x, y: node.y },
    data: {
      nodeKind: node.kind,
      label: node.label,
      details: node.details,
      sequencePorts: diagram.kind === "sequence"
        ? diagram.edges.flatMap((edge) => [
            ...(edge.source === node.id ? [{ id: `${edge.id}-source`, order: edge.order }] : []),
            ...(edge.target === node.id ? [{ id: `${edge.id}-target`, order: edge.order }] : []),
          ])
        : [],
      sequenceNewOrder,
      sequenceHeight: Math.max(300, 120 + (sequenceNewOrder + 1) * 46),
    },
  }))
}

function toCanvasEdges(diagram: UmlDiagramData): Edge[] {
  return diagram.edges.map((edge) => {
    const handles = inferUmlEdgeHandles(diagram, edge)
    return ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label || relationLabel[edge.relation],
    sourceHandle: diagram.kind === "sequence" ? `${edge.id}-source` : handles.sourceHandle,
    targetHandle: diagram.kind === "sequence" ? `${edge.id}-target` : handles.targetHandle,
    type: "umlEdge",
    animated: false,
    data: { relation: edge.relation, sequence: diagram.kind === "sequence" },
    style: {
      stroke: "#667085",
      strokeWidth: 1.4,
      strokeDasharray: getUmlRelationVisual(edge.relation).dashed ? "6 4" : undefined,
    },
    labelStyle: { fontSize: 10, fill: "#475467" },
    labelBgStyle: { fill: "#FFFFFF", fillOpacity: 0.92 },
    labelBgPadding: [4, 2],
    })
  })
}

const isSideHandle = (value: string | null | undefined): value is UmlEdgeEntity["sourceHandle"] =>
  value === "left" || value === "right" || value === "top" || value === "bottom"

function newNodeKind(diagram: UmlDiagramData): UmlNodeKind {
  if (diagram.kind === "class") return "class"
  if (diagram.kind === "sequence") return "participant"
  return diagram.nodes.some((node) => node.kind === "actor") ? "use-case" : "actor"
}

function nextNodeLabel(kind: UmlNodeKind, count: number) {
  return kind === "actor"
    ? `参与者 ${count}`
    : kind === "use-case"
      ? `用例 ${count}`
      : kind === "participant"
        ? `参与者 ${count}`
        : `Class${count}`
}

export default function UmlCanvas({
  diagram,
  onChange,
  captureRef,
  captureOnly = false,
}: {
  diagram: UmlDiagramData
  onChange: (diagram: UmlDiagramData) => void
  captureRef?: RefObject<HTMLDivElement | null>
  captureOnly?: boolean
}) {
  const [nodes, setNodes] = useState<CanvasNode[]>(() => toCanvasNodes(diagram))
  const [edges, setEdges] = useState<Edge[]>(() => toCanvasEdges(diagram))
  const [relation, setRelation] = useState<UmlRelationType>(availableRelations(diagram)[0])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)

  useEffect(() => {
    setNodes(toCanvasNodes(diagram))
    setEdges(toCanvasEdges(diagram))
  }, [diagram])

  useEffect(() => {
    const valid = availableRelations(diagram)
    if (!valid.includes(relation)) setRelation(valid[0])
  }, [diagram, relation])

  const selectedNode = diagram.nodes.find((node) => node.id === selectedNodeId)
  const selectedEdge = diagram.edges.find((edge) => edge.id === selectedEdgeId)
  const relations = useMemo(() => availableRelations(diagram), [diagram])

  const changeNodes = (changes: NodeChange<CanvasNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current))
    const removed = new Set(changes.filter((change) => change.type === "remove").map((change) => change.id))
    if (removed.size) {
      onChange({
        ...diagram,
        nodes: diagram.nodes.filter((node) => !removed.has(node.id)),
        edges: diagram.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)),
      })
      setSelectedNodeId(null)
    }
  }

  const changeEdges = (changes: EdgeChange[]) => {
    setEdges((current) => applyEdgeChanges(changes, current))
    const removed = new Set(changes.filter((change) => change.type === "remove").map((change) => change.id))
    if (removed.size) {
      onChange({ ...diagram, edges: diagram.edges.filter((edge) => !removed.has(edge.id)) })
      setSelectedEdgeId(null)
    }
  }

  const persistNodePosition = (_event: unknown, canvasNode: CanvasNode) => {
    const y = diagram.kind === "sequence" ? 48 : canvasNode.position.y
    onChange({
      ...diagram,
      nodes: diagram.nodes.map((node) =>
        node.id === canvasNode.id ? { ...node, x: canvasNode.position.x, y } : node,
      ),
    })
  }

  const connect = (connection: Connection) => {
    if (!connection.source || !connection.target || (diagram.kind !== "sequence" && connection.source === connection.target)) return
    const order = diagram.kind === "sequence"
      ? Math.max(-1, ...diagram.edges.map((edge) => edge.order)) + 1
      : diagram.edges.length
    const edge: UmlEdgeEntity = {
      id: `uml-edge-${Date.now()}-${order}`,
      source: connection.source,
      target: connection.target,
      relation,
      label: diagram.kind === "sequence" ? "新消息" : "",
      order,
      sourceHandle: diagram.kind !== "sequence" && isSideHandle(connection.sourceHandle)
        ? connection.sourceHandle
        : undefined,
      targetHandle: diagram.kind !== "sequence" && isSideHandle(connection.targetHandle)
        ? connection.targetHandle
        : undefined,
    }
    onChange({ ...diagram, edges: [...diagram.edges, edge] })
    setSelectedEdgeId(edge.id)
    setSelectedNodeId(null)
  }

  const addNode = () => {
    const kind = newNodeKind(diagram)
    const count = diagram.nodes.filter((node) => node.kind === kind).length + 1
    const node: UmlNodeEntity = {
      id: `uml-node-${Date.now()}-${count}`,
      kind,
      label: nextNodeLabel(kind, count),
      x: diagram.kind === "sequence" ? 70 + diagram.nodes.length * 190 : 120 + (diagram.nodes.length % 3) * 220,
      y: diagram.kind === "sequence" ? 48 : 90 + Math.floor(diagram.nodes.length / 3) * 160,
      details: kind === "class" ? ["- field: string"] : [],
    }
    onChange({ ...diagram, nodes: [...diagram.nodes, node] })
    setSelectedNodeId(node.id)
    setSelectedEdgeId(null)
  }

  const deleteSelection = () => {
    if (selectedNodeId) {
      onChange({
        ...diagram,
        nodes: diagram.nodes.filter((node) => node.id !== selectedNodeId),
        edges: diagram.edges.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId),
      })
      setSelectedNodeId(null)
    } else if (selectedEdgeId) {
      onChange({ ...diagram, edges: diagram.edges.filter((edge) => edge.id !== selectedEdgeId) })
      setSelectedEdgeId(null)
    }
  }

  const updateNode = (patch: Partial<UmlNodeEntity>) => {
    if (!selectedNode) return
    onChange({
      ...diagram,
      nodes: diagram.nodes.map((node) => node.id === selectedNode.id ? { ...node, ...patch, id: node.id } : node),
    })
  }

  const updateEdge = (patch: Partial<UmlEdgeEntity>) => {
    if (!selectedEdge) return
    onChange({
      ...diagram,
      edges: diagram.edges.map((edge) => edge.id === selectedEdge.id ? { ...edge, ...patch, id: edge.id } : edge),
    })
  }

  const flow = (
    <div ref={captureRef} className="h-full min-h-0 bg-[#F8FAFC]">
      <ReactFlow<CanvasNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={captureOnly ? undefined : changeNodes}
        onEdgesChange={captureOnly ? undefined : changeEdges}
        onNodeDragStop={captureOnly ? undefined : persistNodePosition}
        onConnect={captureOnly ? undefined : connect}
        connectionMode={ConnectionMode.Loose}
        onNodeClick={captureOnly ? undefined : (_event, node) => { setSelectedNodeId(node.id); setSelectedEdgeId(null) }}
        onEdgeClick={captureOnly ? undefined : (_event, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(null) }}
        onPaneClick={captureOnly ? undefined : () => { setSelectedNodeId(null); setSelectedEdgeId(null) }}
        nodesDraggable={!captureOnly}
        nodesConnectable={!captureOnly}
        elementsSelectable={!captureOnly}
        fitView
        fitViewOptions={{ padding: 0.24, maxZoom: 1.15 }}
        minZoom={0.25}
        maxZoom={2}
        deleteKeyCode={captureOnly ? null : ["Backspace", "Delete"]}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#D0D5DD" gap={24} size={1} />
        {!captureOnly && <MiniMap pannable zoomable nodeColor="#EAECF0" maskColor="rgba(248,250,252,.72)" />}
        {!captureOnly && <Controls showInteractive={false} />}
      </ReactFlow>
    </div>
  )

  if (captureOnly) return flow

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-[#E2E7EE] bg-white px-3 py-2">
        <button className="secondary-button" onClick={addNode}><Plus size={13} />新增节点</button>
        <span className="text-[10px] text-[#667085]">新连线类型</span>
        <select className="filter-select" value={relation} onChange={(event) => setRelation(event.target.value as UmlRelationType)}>
          {relations.map((item) => <option key={item} value={item}>{relationLabel[item]}</option>)}
        </select>
        <button className="icon-button" title="删除选中的节点或连线" disabled={!selectedNodeId && !selectedEdgeId} onClick={deleteSelection}><Trash2 size={14} /></button>
        <span className="ml-auto text-[10px] text-[#98A2B3]">
          {diagram.kind === "sequence" ? "拖动参与者；从生命线圆点拖出消息" : "拖动节点；从任意边缘锚点拖出连线"}
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_250px]">
        {flow}
        <aside className="overflow-y-auto border-l border-[#E2E7EE] bg-white p-3">
          {!selectedNode && !selectedEdge && <div className="py-12 text-center text-[11px] text-[#98A2B3]">选择节点或连线后编辑属性</div>}
          {selectedNode && <div className="space-y-3">
            <div className="text-xs font-semibold text-[#344054]">节点属性</div>
            <label className="block text-[10px] text-[#667085]">名称<input className="form-input mt-1" value={selectedNode.label} onChange={(event) => updateNode({ label: event.target.value })} /></label>
            {diagram.kind === "use-case" && <label className="block text-[10px] text-[#667085]">节点类型<select className="form-input mt-1" value={selectedNode.kind} onChange={(event) => updateNode({ kind: event.target.value as UmlNodeKind })}><option value="actor">参与者</option><option value="use-case">用例</option></select></label>}
            {selectedNode.kind === "class" && <label className="block text-[10px] text-[#667085]">属性和方法<textarea className="form-input mt-1 min-h-44 resize-y font-mono" value={selectedNode.details.join("\n")} onChange={(event) => updateNode({ details: event.target.value.split("\n").map((line) => line.trim()).filter(Boolean) })} placeholder="- name: string\n+ save(): void" /></label>}
            <div className="text-[10px] text-[#98A2B3]">位置 {Math.round(selectedNode.x)}, {Math.round(selectedNode.y)}</div>
            <button className="secondary-button w-full text-[#B42318]" onClick={deleteSelection}><Trash2 size={13} />删除节点</button>
          </div>}
          {selectedEdge && <div className="space-y-3">
            <div className="text-xs font-semibold text-[#344054]">连线属性</div>
            <label className="block text-[10px] text-[#667085]">关系类型<select className="form-input mt-1" value={selectedEdge.relation} onChange={(event) => updateEdge({ relation: event.target.value as UmlRelationType })}>{relations.map((item) => <option key={item} value={item}>{relationLabel[item]}</option>)}</select></label>
            <label className="block text-[10px] text-[#667085]">标签<input className="form-input mt-1" value={selectedEdge.label} onChange={(event) => updateEdge({ label: event.target.value })} placeholder={diagram.kind === "sequence" ? "消息名称" : "可选标签"} /></label>
            {diagram.kind === "sequence" && <label className="block text-[10px] text-[#667085]">消息顺序<input className="form-input mt-1" type="number" min="0" value={selectedEdge.order} onChange={(event) => updateEdge({ order: Number(event.target.value) || 0 })} /></label>}
            <button className="secondary-button w-full text-[#B42318]" onClick={deleteSelection}><Trash2 size={13} />删除连线</button>
          </div>}
        </aside>
      </div>
    </div>
  )
}

export async function renderUmlCanvasPng(container: HTMLDivElement) {
  await document.fonts?.ready
  const flow = container.querySelector<HTMLElement>(".react-flow")
  const viewport = container.querySelector<HTMLElement>(".react-flow__viewport")
  const nodeElements = [...container.querySelectorAll<HTMLElement>(".react-flow__node")]
  if (!flow || !viewport || !nodeElements.length) throw new Error("UML 画布尚未完成渲染")

  const flowRect = flow.getBoundingClientRect()
  const matrix = new DOMMatrixReadOnly(getComputedStyle(viewport).transform)
  const scale = matrix.a || 1
  const bounds = nodeElements.reduce((current, element) => {
    const rect = element.getBoundingClientRect()
    const left = (rect.left - flowRect.left - matrix.e) / scale
    const top = (rect.top - flowRect.top - matrix.f) / scale
    return {
      left: Math.min(current.left, left),
      top: Math.min(current.top, top),
      right: Math.max(current.right, left + rect.width / scale),
      bottom: Math.max(current.bottom, top + rect.height / scale),
    }
  }, { left: Number.POSITIVE_INFINITY, top: Number.POSITIVE_INFINITY, right: Number.NEGATIVE_INFINITY, bottom: Number.NEGATIVE_INFINITY })

  const padding = 32
  const width = Math.max(240, Math.ceil(bounds.right - bounds.left + padding * 2))
  const height = Math.max(180, Math.ceil(bounds.bottom - bounds.top + padding * 2))
  const previousTransform = viewport.style.transform
  container.classList.add("uml-capture-mode")
  viewport.style.transform = `translate(${padding - bounds.left}px, ${padding - bounds.top}px) scale(1)`
  try {
    const blob = await toBlob(flow, {
      width,
      height,
      canvasWidth: width * 2,
      canvasHeight: height * 2,
      pixelRatio: 1,
      backgroundColor: "#F8FAFC",
      cacheBust: true,
      style: { width: `${width}px`, height: `${height}px` },
      filter: (node) => !node.classList?.contains("react-flow__controls") && !node.classList?.contains("react-flow__minimap"),
    })
    if (!blob) throw new Error("PNG 快照生成失败")
    return blob
  } finally {
    viewport.style.transform = previousTransform
    container.classList.remove("uml-capture-mode")
  }
}
