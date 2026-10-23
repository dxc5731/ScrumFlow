import { useState } from "react"
import { AlertTriangle, TrendingDown } from "lucide-react"
import { useProjectStore } from "../../store/projectStore"
import { sprintBurndown } from "../../store/burndown"

const colors = { ideal: "#B5BEC9", actual: "#2878EB", forecast: "#EF8B2C" }
const hours = (value: number | null) =>
  value === null ? "—" : Number(value.toFixed(2)).toLocaleString("zh-CN") + " h"

export default function SprintBurndownChart({
  sprintId,
}: {
  sprintId: string
}) {
  const state = useProjectStore()
  const model = sprintBurndown(state, sprintId)
  const sprint = state.sprints[sprintId]
  const [hover, setHover] = useState<number | null>(null)
  const width = 1000,
    height = 310,
    left = 58,
    right = 28,
    top = 26,
    bottom = 48
  const plotWidth = width - left - right,
    plotHeight = height - top - bottom
  const maxValue = Math.max(
    1,
    ...model.points.flatMap((p) => [p.ideal, p.actual ?? 0, p.forecast ?? 0]),
  )
  const magnitude = Math.pow(10, Math.floor(Math.log10(maxValue)))
  const ceiling = Math.ceil(maxValue / magnitude) * magnitude
  const x = (index: number) =>
    left + (index / Math.max(1, model.points.length - 1)) * plotWidth
  const y = (value: number) => top + (1 - value / ceiling) * plotHeight
  const line = (key: "ideal" | "actual" | "forecast") =>
    model.points
      .map((p, index) => ({ value: p[key], index }))
      .filter((p) => p.value !== null)
      .map((p, index) => (index ? "L" : "M") + x(p.index) + "," + y(p.value!))
      .join(" ")
  const point = hover === null ? null : model.points[hover]
  const hasActual = Boolean(model.snapshots.length)
  const missingClosedHistory = sprint.status === "closed" && !hasActual
  const forecastLabel =
    sprint.status === "closed"
      ? "已关闭"
      : (model.forecastDate ??
        (model.work.remainingHours === 0 && hasActual
          ? "已完成"
          : "暂无法预测"))
  return (
    <section
      aria-label="Sprint 燃尽图"
      className="mb-5 overflow-hidden rounded-xl border border-[#E2E7EE] bg-white"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[#172033]">
            <TrendingDown size={17} className="text-[#2878EB]" />
            Sprint 燃尽图
          </h3>
          <p className="mt-1 text-[11px] text-[#667085]">
            剩余工时 · 按自然日记录 · {sprint.name}
          </p>
        </div>
        <div className="flex flex-wrap gap-4 pt-1 text-[11px] text-[#667085]">
          {(["ideal", "actual", "forecast"] as const).map((key) => (
            <span key={key} className="flex items-center gap-1.5">
              <svg width="28" height="12" aria-hidden="true">
                <line
                  x1="1"
                  x2="27"
                  y1="6"
                  y2="6"
                  stroke={colors[key]}
                  strokeWidth="2"
                  strokeDasharray={key === "forecast" ? "5 3" : undefined}
                />
                {key === "ideal" && (
                  <circle
                    cx="14"
                    cy="6"
                    r="3"
                    fill="white"
                    stroke={colors[key]}
                  />
                )}{" "}
                {key === "actual" && (
                  <rect x="11" y="3" width="6" height="6" fill={colors[key]} />
                )}
              </svg>
              {key === "ideal"
                ? "Ideal 理想"
                : key === "actual"
                  ? "Actual 实际"
                  : "Forecast 预测"}
            </span>
          ))}
        </div>
      </div>
      <div className="mx-5 mt-4 grid grid-cols-2 gap-3 border-y border-[#F0F2F5] py-4 lg:grid-cols-4">
        <Metric
          label="Sprint 总工时"
          value={missingClosedHistory ? "—" : hours(model.work.totalHours)}
          note={
            missingClosedHistory
              ? "关闭前未记录工时基线"
              : "初始基线 " + hours(model.baselineHours)
          }
        />
        <Metric
          label="当前剩余工时"
          value={missingClosedHistory ? "—" : hours(model.work.remainingHours)}
          note={
            hasActual
              ? "最近记录 " + model.latest!.date
              : "当前范围，尚未开始记录"
          }
        />
        <Metric
          label="已完成比例"
          value={missingClosedHistory ? "—" : model.completedPercent + "%"}
          note="按叶子任务工时加权"
        />
        <Metric
          label="预计完成日期"
          value={forecastLabel}
          note={
            model.velocity > 0
              ? "净燃尽速度 " + hours(model.velocity) + " / 天"
              : model.zeroSpeed
                ? "当前净燃尽速度不为正"
                : "需至少两个日期的快照"
          }
          warning={model.delayed}
        />
      </div>
      <div className="mx-5 mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        {model.delayed && (
          <span
            role="status"
            className="flex items-center gap-1 text-[#B54708]"
          >
            <AlertTriangle size={13} />
            {model.forecastDate
              ? "可能延期：预计超出 Sprint 结束日期"
              : "可能延期：当前燃尽速度无法支持按期完成"}
          </span>
        )}
        {model.behind && sprint.status !== "closed" && (
          <span className="text-[#B54708]">
            进度落后：实际剩余工时高于理想曲线
          </span>
        )}
        {sprint.status === "closed" && (
          <span className="text-[#667085]">
            已冻结关闭前快照；移出的未完成工作不会记为已燃尽。
          </span>
        )}
      </div>
      {missingClosedHistory ? (
        <div className="px-6 py-14 text-center">
          <p className="text-sm text-[#667085]">此 Sprint 暂无历史燃尽快照</p>
          <p className="mt-2 text-xs text-[#98A2B3]">
            关闭前尚未启用记录，无法还原当时的工时与进度。
          </p>
        </div>
      ) : model.work.itemCount === 0 && !hasActual ? (
        <div className="px-6 py-14 text-center">
          <p className="text-sm text-[#667085]">尚无可统计的工程任务</p>
          <p className="mt-2 text-xs text-[#98A2B3]">
            为 Sprint 中的 Story 拆解 Task / Subtask
            并估算工时后，即可查看燃尽情况。
          </p>
        </div>
      ) : (
        <div className="relative mx-2 mt-2" onMouseLeave={() => setHover(null)}>
          <svg
            viewBox={"0 0 " + width + " " + height}
            className="block w-full"
            role="img"
            aria-label={
              sprint.name + "燃尽图：灰色理想工时、蓝色实际工时、橙色预测工时"
            }
          >
            <text x={left} y="14" fontSize="10" fill="#667085">
              Remaining Work (h)
            </text>
            {Array.from({ length: 5 }, (_, i) => {
              const value = (ceiling * i) / 4
              return (
                <g key={i}>
                  <line
                    x1={left}
                    x2={width - right}
                    y1={y(value)}
                    y2={y(value)}
                    stroke="#EAECF0"
                  />
                  <text
                    x={left - 10}
                    y={y(value) + 3}
                    textAnchor="end"
                    fontSize="10"
                    fill="#98A2B3"
                  >
                    {Number(value.toFixed(2))}
                  </text>
                </g>
              )
            })}
            {model.points.map((p, index) =>
              (index % Math.max(1, Math.ceil(model.points.length / 12)) === 0 &&
                model.points.length - 1 - index >
                  Math.ceil(model.points.length / 12) / 2) ||
              index === model.points.length - 1 ? (
                <g key={p.date}>
                  <line
                    x1={x(index)}
                    x2={x(index)}
                    y1={top}
                    y2={height - bottom}
                    stroke="#F2F4F7"
                  />
                  <text
                    x={x(index)}
                    y={height - bottom + 20}
                    textAnchor="middle"
                    fontSize="10"
                    fill="#667085"
                  >
                    Day {p.day}
                  </text>
                  <text
                    x={x(index)}
                    y={height - bottom + 35}
                    textAnchor="middle"
                    fontSize="8"
                    fill="#98A2B3"
                  >
                    {p.date.slice(5)}
                  </text>
                </g>
              ) : null,
            )}
            <path
              d={line("ideal")}
              fill="none"
              stroke={colors.ideal}
              strokeWidth="2"
            />
            <path
              d={line("actual")}
              fill="none"
              stroke={colors.actual}
              strokeWidth="2.5"
            />
            <path
              d={line("forecast")}
              fill="none"
              stroke={colors.forecast}
              strokeWidth="2"
              strokeDasharray="6 4"
            />
            {model.points.map((p, index) => (
              <g key={p.date}>
                <circle
                  cx={x(index)}
                  cy={y(p.ideal)}
                  r="2.7"
                  fill="white"
                  stroke={colors.ideal}
                  strokeWidth="1.5"
                />
                {p.actual !== null && (
                  <rect
                    x={x(index) - 3.3}
                    y={y(p.actual) - 3.3}
                    width="6.6"
                    height="6.6"
                    rx=".5"
                    fill={colors.actual}
                  />
                )}
                <rect
                  x={
                    x(index) - Math.max(5, plotWidth / model.points.length / 2)
                  }
                  y={top}
                  width={Math.max(10, plotWidth / model.points.length)}
                  height={plotHeight}
                  fill="transparent"
                  tabIndex={0}
                  role="button"
                  aria-label={
                    p.date +
                    "：理想 " +
                    hours(p.ideal) +
                    "，实际 " +
                    hours(p.actual) +
                    "，预测 " +
                    hours(p.forecast)
                  }
                  onMouseEnter={() => setHover(index)}
                  onFocus={() => setHover(index)}
                  onBlur={() => setHover(null)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setHover(null)
                  }}
                />
              </g>
            ))}
            {point && (
              <line
                x1={x(hover!)}
                x2={x(hover!)}
                y1={top}
                y2={height - bottom}
                stroke="#D0D5DD"
                strokeDasharray="3 3"
                pointerEvents="none"
              />
            )}
          </svg>
          {point && (
            <div
              role="tooltip"
              className="pointer-events-none absolute top-3 z-10 min-w-44 rounded-lg border border-[#EAECF0] bg-white p-3 text-[11px] shadow-lg"
              style={{
                left:
                  Math.min(74, Math.max(2, (x(hover!) / width) * 100 - 8)) +
                  "%",
              }}
            >
              <b className="mb-2 block text-[#344054]">
                Day {point.day} · {point.date}
              </b>
              <p className="flex justify-between gap-6 text-[#667085]">
                <span>Ideal 理想</span>
                <span>{hours(point.ideal)}</span>
              </p>
              <p className="mt-1 flex justify-between gap-6 text-[#2878EB]">
                <span>Actual 实际</span>
                <span>
                  {point.actual === null ? "未记录" : hours(point.actual)}
                </span>
              </p>
              <p className="mt-1 flex justify-between gap-6 text-[#C76B12]">
                <span>Forecast 预测</span>
                <span>
                  {point.forecast === null ? "未预测" : hours(point.forecast)}
                </span>
              </p>
            </div>
          )}
        </div>
      )}
      <div className="border-t border-[#F2F4F7] px-5 py-3 text-[10px] leading-relaxed text-[#98A2B3]">
        {sprint.status === "planning"
          ? "规划预览：启动 Sprint 后冻结初始工时基线并开始记录实际进度。"
          : model.record?.baselineKind === "first-observation"
            ? "历史数据未补造；从 " +
              model.record.baselineDate +
              " 首次观测开始记录，初始基线取首次观测时的总工时。"
            : "初始基线在 Sprint 启动时冻结；新增范围或工时调整会反映在实际曲线上。"}
        <span className="block">
          剩余工时 = 预计工时 × (1 − 进度)，已完成项计
          0；有子任务时只统计子任务。每天保留最后一次观测；空缺日期不补值，连线仅连接已记录点。预测使用首末观测之间的日均净燃尽速度。
        </span>
      </div>
    </section>
  )
}
function Metric({
  label,
  value,
  note,
  warning = false,
}: {
  label: string
  value: string
  note: string
  warning?: boolean
}) {
  return (
    <div>
      <p className="text-[10px] text-[#667085]">{label}</p>
      <p
        className={
          "mt-1 text-lg font-semibold " +
          (warning ? "text-[#B54708]" : "text-[#172033]")
        }
      >
        {value}
      </p>
      <p className="mt-1 text-[10px] text-[#98A2B3]">{note}</p>
    </div>
  )
}
