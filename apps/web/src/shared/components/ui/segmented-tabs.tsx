import { useRef } from "react"
import type { KeyboardEvent } from "react"

import { cn } from "@/shared/lib/utils"

interface SegmentedTabsProps<T extends string> {
  label: string
  items: readonly { value: T; label: string }[]
  value: T
  onChange(value: T): void
  variant?: "pill" | "underline"
  className?: string
}

export function SegmentedTabs<T extends string>({
  label,
  items,
  value,
  onChange,
  variant = "pill",
  className,
}: SegmentedTabsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const focusAt = (index: number) => {
    refs.current[(index + items.length) % items.length]?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault()
        focusAt(index + 1)
        break
      case "ArrowLeft":
        event.preventDefault()
        focusAt(index - 1)
        break
      case "Home":
        event.preventDefault()
        focusAt(0)
        break
      case "End":
        event.preventDefault()
        focusAt(items.length - 1)
        break
    }
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        variant === "pill" ? "inline-flex rounded-lg bg-muted p-1" : "flex gap-4 border-b",
        className
      )}
    >
      {items.map((item, index) => {
        const selected = item.value === value
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[index] = el
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              if (!selected) onChange(item.value)
            }}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "text-sm text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              variant === "pill"
                ? cn("rounded-md px-3 py-1", selected && "bg-background text-foreground shadow-sm")
                : cn("-mb-px px-1 pb-2", selected && "border-b-2 border-primary font-medium text-foreground")
            )}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
