import type { TaskStatus } from "../../types"

export const TASK_STATUS_COLORS: Record<
  TaskStatus,
  {
    color: string
    accent: string
    bg: string
    strongBg: string
    border: string
  }
> = {
  todo: {
    color: "#067647",
    accent: "#12B76A",
    bg: "#ECFDF3",
    strongBg: "#D1FADF",
    border: "#ABEFC6",
  },
  in_progress: {
    color: "#175CD3",
    accent: "#2E90FA",
    bg: "#EFF8FF",
    strongBg: "#D1E9FF",
    border: "#B2DDFF",
  },
  review: {
    color: "#B54708",
    accent: "#F79009",
    bg: "#FFFAEB",
    strongBg: "#FEEFC7",
    border: "#FEDF89",
  },
  done: {
    color: "#475467",
    accent: "#98A2B3",
    bg: "#F2F4F7",
    strongBg: "#EAECF0",
    border: "#D0D5DD",
  },
  blocked: {
    color: "#B42318",
    accent: "#D92D20",
    bg: "#FEF3F2",
    strongBg: "#FEE4E2",
    border: "#FECDCA",
  },
}
