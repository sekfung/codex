import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/// Standard shadcn/ui class merger: `clsx` for conditional composition,
/// `tailwind-merge` so a caller-supplied `className` reliably overrides a
/// component's own utilities instead of both landing in the class list.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
