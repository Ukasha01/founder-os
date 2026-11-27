// A short fade-and-rise each time you open a screen, so navigation feels like movement and not a flash.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-in">{children}</div>;
}
