/**
 * Standardized icon system built on lucide-react.
 *
 * All icons are re-exported under their legacy names so existing imports
 * (`import { BotIcon, CloseIcon } from '../shared/Icons'`) continue to work.
 */
import React from 'react';
import { Loader2, Bookmark, type LucideProps } from 'lucide-react';

// ---------------------------------------------------------------------------
// Direct re-exports: lucide icon → legacy name
// ---------------------------------------------------------------------------
export {
  User as UserIcon,
  Bot as BotIcon,
  Upload as UploadIcon,
  Send as SendIcon,
  X as CloseIcon,
  Link as LinkIcon,
  History as HistoryIcon,
  Search as SearchIcon,
  Copy as CopyIcon,
  Check as CheckIcon,
  Trash2 as TrashIcon,
  Archive as ArchiveIcon,
  Users as SwitchUserIcon,
  Download as ExportIcon,
  Bookmark as BookmarkIcon,
  ArrowDown as ArrowDownIcon,
  ArrowUp as ArrowUpIcon,
  ChevronDown as ChevronDownIcon,
  Lock as LockIcon,
  Settings as SettingsIcon,
  Eye as EyeIcon,
  Star as StarIcon,
  MoreVertical as KebabMenuIcon,
  Maximize as FullscreenEnterIcon,
  Minimize as FullscreenExitIcon,
  Code as CodeIcon,
  Brain as BrainIcon,
  Pencil as EditIcon,
  RefreshCw as RefreshIcon,
  RefreshCw as UpdateIcon,
  RefreshCw as RetryIcon,
  BarChart3 as ChartBarIcon,
  Activity as ActivityIcon,
  Bell as BellIcon,
  Camera as CameraIcon,
  Plus as PlusIcon,
  FlaskConical as AISettingsIcon,
  ChevronUp as ChevronUpIcon,
  ChevronRight as ChevronRightIcon,
  ChevronLeft as ChevronLeftIcon,
  CloudOff as CloudOffIcon,
  Wifi as WifiIcon,
  Menu as HamburgerIcon,
  TrendingUp as TrendUpIcon,
  TrendingDown as TrendDownIcon,
  AlertTriangle as AlertTriangleIcon,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Wrapped icons that need special behaviour
// ---------------------------------------------------------------------------

/** Spinning loader — wraps lucide Loader2 with animate-spin. */
export const LoadingIcon: React.FC<LucideProps> = (props) => (
  <Loader2 {...props} className={`animate-spin ${props.className ?? ''}`} />
);

/** Filled/solid bookmark — lucide Bookmark with fill applied. */
export const BookmarkSolidIcon: React.FC<LucideProps> = (props) => (
  <Bookmark {...props} fill="currentColor" />
);
