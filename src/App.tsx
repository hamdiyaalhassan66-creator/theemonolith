import DirectoryView from "./components/DirectoryView"
import { MOBILE_DEFAULT_PROPS } from "./components/InfiniteDragCanvasMobile"
import logoLight from "./assets/logo-light.png"
import logoDark from "./assets/logo-dark.png"

function App() {
    return (
        <div style={{ width: "100%", height: "100vh", overflow: "hidden" }}>
            <DirectoryView
                desktopProps={{
                    logoGroup: {
                        logo: logoLight,
                        logoDark: logoDark,
                    },
                    musicCD: {
                        cellSize: 300,
                        gap: 150,
                        patternCols: 8,
                        patternRows: 8,
                        hoverScale: 1.3,
                        borderRadius: 0,
                        holeSize: 36,
                        dragScale: 0.9,
                        spineDepth: 10,
                        textureImg: "https://framerusercontent.com/images/wOYnMr6g110aljmBAwXpmnCE3wg.png",
                        textureOpacity: 40,
                        textureBlend: "screen",
                    },
                    booksGroup: {
                        width: 270,
                        spineWidth: 36,
                        borderRadius: 4,
                        spineDepth: 30,
                        textureImg: "https://framerusercontent.com/images/cQ1LQXabneL48EyeMPgD4Ed9Ak.png",
                        textureOpacity: 50,
                        textureBlend: "screen",
                    },
                    filmGroup: {
                        width: 290,
                        spineWidth: 0,
                        borderRadius: 4,
                        spineDepth: 12,
                        textureImg: "https://framerusercontent.com/images/RLTKe592ZMuEyQ1EbjRymWu31sk.png",
                        textureOpacity: 40,
                        textureBlend: "screen",
                    },
                    filtersGroup: {
                        blurIntensity: 24,
                        contrast: 95,
                        shadowIntensity: 40,
                        noiseEnabled: true,
                        noiseOpacity: 20,
                        noiseSize: 180,
                        noiseBlend: "overlay",
                    },
                    infoGroup: {
                        showInfoOnHover: true,
                        infoAccentColor: "#E298F2",
                        infoTextColor: "#1C1C1C",
                        infoFontSize: 14,
                    },
                    carouselGroup: {
                        musicSpineGroup: {
                            itemWidth: 400,
                            itemHeight: 400,
                            edgeGap: -250,
                            spineDepth: 6,
                            spineTextEnabled: true,
                            spineTextColor: "auto",
                            spineFontSize: 6,
                            spineFontWeight: 600,
                            spineCreatorFontWeight: 400,
                        },
                        filmSpineGroup: {
                            filmItemWidth: 310,
                            filmItemHeight: 460,
                            filmEdgeGap: -150,
                            filmSpineDepth: 10,
                            filmSpineTextEnabled: true,
                            filmSpineTextColor: "auto",
                            filmSpineFontSize: 8,
                            filmSpineFontWeight: 600,
                            filmSpineCreatorFontWeight: 400,
                        },
                        booksSpineGroup: {
                            bookItemWidth: 290,
                            bookEdgeGap: -100,
                            bookSpineDepth: 25,
                            bookSpineTextEnabled: true,
                            bookSpineTextColor: "auto",
                            bookSpineFontSize: 11,
                            bookSpineFontWeight: 600,
                            bookSpineCreatorFontWeight: 400,
                        },
                        rotationPerItem: 6,
                        coverflowDepth: 0,
                        perspective: 500,
                        tiltX: 0,
                        autoRotate: true,
                        autoRotateSpeed: 40,
                        dragToRotate: true,
                        dragSensitivity: 2,
                        borderRadius: 0,
                        shadow: false,
                    },
                }}
                mobileProps={{
                    ...MOBILE_DEFAULT_PROPS,
                    logoGroup: {
                        logo: logoLight,
                        logoDark: logoDark,
                        logoHeight: 24,
                    },
                    musicCD: {
                        cellSize: 220,
                        gap: 60,
                        patternCols: 4,
                        patternRows: 5,
                        borderRadius: 0,
                        spineDepth: 8,
                        textureImg: "https://framerusercontent.com/images/wOYnMr6g110aljmBAwXpmnCE3wg.png",
                        textureOpacity: 40,
                        textureBlend: "screen",
                    },
                    booksGroup: {
                        width: 150,
                        spineWidth: 14,
                        borderRadius: 4,
                        spineDepth: 20,
                        textureImg: "https://framerusercontent.com/images/cQ1LQXabneL48EyeMPgD4Ed9Ak.png",
                        textureOpacity: 50,
                        textureBlend: "screen",
                    },
                    filmGroup: {
                        width: 150,
                        spineWidth: 6,
                        borderRadius: 4,
                        spineDepth: 8,
                        textureImg: "https://framerusercontent.com/images/RLTKe592ZMuEyQ1EbjRymWu31sk.png",
                        textureOpacity: 40,
                        textureBlend: "screen",
                    },
                    filtersGroup: {
                        contrast: 95,
                        shadowIntensity: 20,
                        noiseEnabled: true,
                        noiseOpacity: 20,
                        noiseSize: 180,
                        noiseBlend: "overlay",
                    },
                    carouselGroup: {
                        musicSpineGroup: {
                            itemWidth: 250,
                            itemHeight: 250,
                            edgeGap: -160,
                            spineDepth: 4,
                        },
                        filmSpineGroup: {
                            filmItemWidth: 200,
                            filmEdgeGap: -100,
                            filmSpineDepth: 8,
                        },
                        booksSpineGroup: {
                            bookItemWidth: 180,
                            bookEdgeGap: -90,
                            bookSpineDepth: 20,
                        },
                        rotationPerItem: 6,
                        coverflowDepth: 0,
                        perspective: 400,
                        tiltX: 0,
                        autoRotate: true,
                        autoRotateSpeed: 40,
                        dragToRotate: true,
                        dragSensitivity: 2,
                        borderRadius: 0,
                    },
                }}
            />
        </div>
    )
}

export default App