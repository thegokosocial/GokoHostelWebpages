export type NavItem =
  | { label: string; href: string; external?: boolean }
  | {
      label: string;
      children: { label: string; href: string }[];
    };

export const mainNav: NavItem[] = [
  { label: "Events", href: "/events" },
  {
    label: "About",
    children: [
      { label: "Our Story", href: "/story" },
      { label: "How to Reach", href: "/how-to-reach" },
      { label: "Things to Do", href: "/things-to-do" },
      { label: "FAQs", href: "/faqs" },
    ],
  },
  { label: "Stay", href: "/stay" },
  { label: "Community Area", href: "/community-area" },
  { label: "Reviews", href: "/reviews" },
];
