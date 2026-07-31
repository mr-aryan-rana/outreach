import {
  LayoutDashboard,
  Users,
  FileEdit,
  Megaphone,
  ListOrdered,
  Mail,
  ShieldOff,
  Send,
  BarChart3,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, shortcut: "g d" },
  { href: "/creators", label: "Creators", icon: Users, shortcut: "g c" },
  { href: "/drafts", label: "AI Draft Review", icon: FileEdit, shortcut: "g a" },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone, shortcut: "g m" },
  { href: "/queue", label: "Queue", icon: ListOrdered, shortcut: "g q" },
  { href: "/email-events", label: "Email Events", icon: Mail, shortcut: "g e" },
  { href: "/suppression", label: "Suppression List", icon: ShieldOff, shortcut: "g s" },
  { href: "/sender-profiles", label: "Sender Profiles", icon: Send, shortcut: "g p" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, shortcut: "g y" },
  { href: "/settings", label: "Settings", icon: Settings, shortcut: "g ," },
];
