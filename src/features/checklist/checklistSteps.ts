import type { LucideIcon } from 'lucide-react';
import { MessageCircle, PackagePlus, Printer, Sparkles } from 'lucide-react';

export type ChecklistStepId = 'create-bin' | 'add-three-bins' | 'ask-ai' | 'print-label';

export interface ChecklistContext {
  totalBins: number;
  hasPhoto: boolean;
  aiAskedAt: string | null;
  printVisitedAt: string | null;
}

export interface ChecklistStep {
  id: ChecklistStepId;
  title: string;
  description: string;
  icon: LucideIcon;
  isComplete: (ctx: ChecklistContext) => boolean;
}

export const CHECKLIST_STEPS: ChecklistStep[] = [
  {
    id: 'create-bin',
    title: 'Add your first bin',
    description: 'Snap a photo and let AI fill it in',
    icon: PackagePlus,
    isComplete: (ctx) => ctx.totalBins > 0,
  },
  {
    id: 'add-three-bins',
    title: 'Build out your shelf',
    description: 'Reach 3 bins so AI search has something to work with',
    icon: Sparkles,
    isComplete: (ctx) => ctx.totalBins >= 3,
  },
  {
    id: 'ask-ai',
    title: 'Ask AI to find something',
    description: 'Type a question — AI checks every bin',
    icon: MessageCircle,
    isComplete: (ctx) => ctx.aiAskedAt !== null,
  },
  {
    id: 'print-label',
    title: 'Print your first label',
    description: 'A QR sticker turns any bin into a tap-to-open shortcut',
    icon: Printer,
    isComplete: (ctx) => ctx.printVisitedAt !== null,
  },
];
