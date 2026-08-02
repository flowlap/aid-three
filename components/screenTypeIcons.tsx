import {
  BarChart3,
  BookOpenText,
  BookText,
  Clock,
  Columns2,
  HelpCircle,
  Image as ImageIcon,
  ListChecks,
  Network,
  NotebookText,
  Quote,
  Type,
  User,
  Workflow,
} from "lucide-react";

/** Shared by ScreenMockup and NotebookLmMockup so both mockup styles use the same icon per screen type. */
export const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "간지/타이틀형": BookOpenText,
  "텍스트 강조형": Type,
  "인물 등장형": User,
  "이미지 설명형": ImageIcon,
  "표/그래프형": BarChart3,
  "인포그래픽형": Network,
  "절차 애니메이션형": Workflow,
  "비교 대조형": Columns2,
  "타임라인형": Clock,
  "용어 정의형": BookText,
  "질문/퀴즈형": HelpCircle,
  "인용/사례형": Quote,
  "체크리스트형": ListChecks,
  "요약/정리형": NotebookText,
};

export { ImageIcon as DefaultTypeIcon };
