/**
 * Icons come from lucide-react — a compiled-in dependency, tree-shaken into the
 * bundle, never fetched at runtime (docs/THREAT-MODEL.md: no CDN).
 *
 * They are re-exported under Samvad-local names so the rest of the app depends on
 * our vocabulary ("LeaveIcon"), not lucide's ("PhoneOff"). Swapping icon sets
 * later is then a change to this file alone.
 */
import {
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  EyeOff,
  Hand,
  Headphones,
  LayoutGrid,
  Lock,
  Maximize2,
  MessageSquare,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  MoreHorizontal,
  PhoneOff,
  Pin,
  Search,
  SendHorizontal,
  Settings,
  Smile,
  Share2,
  ShieldCheck,
  SquareUser,
  UserX,
  Users,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X,
  type LucideProps,
} from 'lucide-react'

export type IconProps = LucideProps

export const MicIcon = Mic
export const MicOffIcon = MicOff
export const VideoIcon = Video
export const VideoOffIcon = VideoOff
export const ScreenShareIcon = MonitorUp
export const UsersIcon = Users
export const ChatIcon = MessageSquare
export const SendIcon = SendHorizontal
export const ReactIcon = Smile
export const SearchIcon = Search
export const PinIcon = Pin
export const HandIcon = Hand
export const HeadphonesIcon = Headphones
export const LeaveIcon = PhoneOff
export const ShieldIcon = ShieldCheck
export const SettingsIcon = Settings
export const CopyIcon = Copy
export const CheckIcon = Check
export const ChevronDownIcon = ChevronDown
export const VolumeIcon = Volume2
export const VolumeOffIcon = VolumeX
export const ArrowRightIcon = ArrowRight
export const RemoveUserIcon = UserX
export const ShareIcon = Share2
export const GridIcon = LayoutGrid
export const SpeakerViewIcon = SquareUser
export const MoreIcon = MoreHorizontal
export const MaximizeIcon = Maximize2
export const MinimizeIcon = Minimize2
export const CloseIcon = X
export const EyeOffIcon = EyeOff
export const LockIcon = Lock
