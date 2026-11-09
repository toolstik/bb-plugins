import type { ButtonHTMLAttributes, InputHTMLAttributes } from "react";
export function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className="inline-flex h-9 items-center justify-center rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50" />;
}
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50" />;
}
