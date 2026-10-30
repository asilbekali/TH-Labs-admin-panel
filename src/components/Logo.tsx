/**
 * The TH-Labs mark, from public/. The artwork is black on transparent, so
 * `--logo-filter` inverts it on dark surfaces — one asset for both themes.
 */
export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <div className={`brand-mark ${className}`.trim()}>
      <img src="/logo-transparent.png" alt="TH-Labs" draggable={false} />
    </div>
  )
}
