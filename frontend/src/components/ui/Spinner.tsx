export default function Spinner({ size = 16, className = '' }: { size?: number; className?: string }) {
  return <span role="status" aria-label="Loading" className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} style={{ width: size, height: size }} />;
}
export { Spinner };
