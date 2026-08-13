import { useEffect, useState } from "react"
import InfiniteDragCanvas, { DESKTOP_DEFAULT_PROPS } from "./InfiniteDragCanvas"
import InfiniteDragCanvasMobile, { MOBILE_DEFAULT_PROPS } from "./InfiniteDragCanvasMobile"

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState<boolean | null>(null)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint)
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [breakpoint])

  return isMobile
}

interface DirectoryViewProps {
  desktopProps?: typeof DESKTOP_DEFAULT_PROPS
  mobileProps?: typeof MOBILE_DEFAULT_PROPS
}

export default function DirectoryView({
  desktopProps = DESKTOP_DEFAULT_PROPS,
  mobileProps = MOBILE_DEFAULT_PROPS,
}: DirectoryViewProps) {
  const isMobile = useIsMobile()

  if (isMobile === null) return null

  return isMobile
    ? <InfiniteDragCanvasMobile {...mobileProps} />
    : <InfiniteDragCanvas {...desktopProps} />
}