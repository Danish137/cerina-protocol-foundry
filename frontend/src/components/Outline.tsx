import React, { useState, useEffect, useMemo } from 'react'
import { List, ChevronRight } from 'lucide-react'

interface OutlineItem {
  id: string
  text: string
  level: 2 | 3
  index: number
}

interface OutlineProps {
  content: string
  scrollerRef?: React.RefObject<HTMLDivElement | null>
  onHeadingClick?: (text: string) => void
  isDropdown?: boolean // for compact mode toolbar dropdown (C/D2)
}

export default function Outline({
  content,
  scrollerRef,
  onHeadingClick,
  isDropdown = false
}: OutlineProps) {
  const [activeId, setActiveId] = useState<string>('')

  // Extract H2 and H3 headings from markdown (D2)
  const items = useMemo(() => {
    if (!content) return []
    const lines = content.split('\n')
    const result: OutlineItem[] = []
    let h2Count = 0

    lines.forEach((line) => {
      const h2Match = line.match(/^##\s+(.+)$/)
      const h3Match = line.match(/^###\s+(.+)$/)

      if (h2Match) {
        h2Count++
        const clean = h2Match[1]
          .replace(/\*\*\*(.*?)\*\*\*/g, '$1')
          .replace(/\*\*(.*?)\*\*/g, '$1')
          .replace(/\*(.*?)\*/g, '$1')
          .replace(/___(.*?)___/g, '$1')
          .replace(/__(.*?)__/g, '$1')
          .replace(/_(.*?)_/g, '$1')
          .replace(/`([^`]+)`/g, '$1')
          .trim()
        result.push({
          id: `heading-${clean.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          text: clean,
          level: 2,
          index: h2Count
        })
      } else if (h3Match) {
        const clean = h3Match[1]
          .replace(/\*\*\*(.*?)\*\*\*/g, '$1')
          .replace(/\*\*(.*?)\*\*/g, '$1')
          .replace(/\*(.*?)\*/g, '$1')
          .replace(/___(.*?)___/g, '$1')
          .replace(/__(.*?)__/g, '$1')
          .replace(/_(.*?)_/g, '$1')
          .replace(/`([^`]+)`/g, '$1')
          .trim()
        result.push({
          id: `heading-${clean.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          text: clean,
          level: 3,
          index: h2Count
        })
      }
    })
    return result
  }, [content])

  const totalH2 = items.filter((i) => i.level === 2).length

  // IntersectionObserver scroll-spy (D2)
  useEffect(() => {
    const scroller = scrollerRef?.current || document.querySelector('article')?.parentElement
    if (!scroller) return

    const headings = scroller.querySelectorAll('article h2, article h3')
    if (headings.length === 0) return

    // Set initial active
    if (!activeId && items.length > 0) {
      setActiveId(items[0].text)
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const headingText = entry.target.textContent || ''
            setActiveId(headingText.trim())
            break
          }
        }
      },
      {
        root: scroller,
        rootMargin: '-64px 0px -65% 0px',
        threshold: [0, 1]
      }
    )

    headings.forEach((h) => observer.observe(h))

    return () => observer.disconnect()
  }, [content, scrollerRef, items])

  const handleClick = (item: OutlineItem) => {
    setActiveId(item.text)
    if (onHeadingClick) {
      onHeadingClick(item.text)
    } else {
      const scroller = scrollerRef?.current || document.querySelector('article')?.parentElement
      const headings = scroller?.querySelectorAll('article h2, article h3')
      if (headings) {
        for (const el of headings) {
          if (el.textContent?.trim().includes(item.text)) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' })
            break
          }
        }
      }
    }
  }

  // Find active H2 to only expand its child H3s (D2)
  const activeItem = items.find((i) => activeId.includes(i.text) || i.text.includes(activeId))
  const currentSectionNumber = activeItem ? (activeItem.level === 2 ? activeItem.index : activeItem.index) : 1

  if (items.length === 0) return null

  if (isDropdown) {
    return (
      <div className="relative inline-block text-xs">
        <select
          value={activeId}
          onChange={(e) => {
            const found = items.find((i) => i.text === e.target.value)
            if (found) handleClick(found)
          }}
          className="px-2.5 py-1 rounded-md border border-[#E8E4DA] bg-white text-xs font-medium text-[#18221E] focus:outline-none"
        >
          {items.map((item) => (
            <option key={item.id} value={item.text}>
              {item.level === 3 ? `  └ ${item.text}` : item.text}
            </option>
          ))}
        </select>
      </div>
    )
  }

  return (
    <div className="bg-white border border-[#E8E4DA] rounded-2xl p-4 shadow-2xs space-y-3 select-none">
      <div className="flex items-center justify-between pb-2 border-b border-[#F0ECE3]">
        <div className="flex items-center gap-2">
          <List className="w-3.5 h-3.5 text-[#244F3B]" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#18221E]">Document Outline</h3>
        </div>
        {totalH2 > 0 && (
          <span className="text-[10px] font-mono font-semibold text-[#7C8B82]">
            Section {currentSectionNumber} of {totalH2}
          </span>
        )}
      </div>

      <nav className="space-y-1 max-h-[320px] overflow-y-auto" aria-label="Table of contents">
        {items.map((item) => {
          const isActive = activeId.includes(item.text) || item.text.includes(activeId)
          const isH3 = item.level === 3

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleClick(item)}
              aria-current={isActive ? 'location' : undefined}
              className={`w-full text-left py-1 text-xs rounded-md transition-all flex items-center gap-1.5 cursor-pointer ${
                isH3 ? 'pl-4 text-[11px]' : 'pl-2'
              } ${
                isActive
                  ? 'font-semibold text-[#244F3B] bg-[#EBF3EE] border-l-2 border-[#244F3B]'
                  : 'text-[#55635C] hover:text-[#18221E] hover:bg-[#FAF8F5]'
              }`}
            >
              <ChevronRight
                className={`w-3 h-3 transition-transform ${
                  isActive ? 'text-[#244F3B] rotate-90' : 'text-[#A0ACA5]'
                }`}
              />
              <span className="truncate">{item.text}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
