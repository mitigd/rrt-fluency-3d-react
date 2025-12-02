import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import * as THREE from "three";
import "chart.js/auto";
import { Line } from "react-chartjs-2";

// --- THEME DEFINITIONS ---
// Only using dark definitions as per requirements, but structure kept for code compatibility
const THEME = {
    dark: {
        bg: "#0f172a", // slate-900
        text: "#f8fafc", // slate-50
        grid: "#334155", // slate-700
        surface: "#1e293b",
        border: "#334155",
        avatarFill: "#ae1bdfff", // slate-200
    },
};

const COMMON = {
    target: "#22c55e", // green-500
    wrong: "#ef4444", // red-500
    accent: "#0ea5e9", // sky-500
    purple: "#9c27b0",
    dim: "#64748b",
};

// --- Types ---
type Attribute = "color" | "shape" | "size" | "position";
type ShapeType = "cube" | "sphere" | "tetrahedron";
type ColorType = "red" | "blue" | "green";
type SizeType = "small" | "medium" | "large";
type PositionType = "left" | "center" | "right";
type PerspectiveType = "symbolic" | "spatial";
type SpatialRepType = "rotation" | "folding" | "cutout" | "instant";
type ObserverPos = "me" | "opposite";
type SpatialMatchMode = "view" | "object";
type UserAction = "match" | "non_match";
type PhysicalSide = "left" | "right";

interface Stimulus {
    color: ColorType;
    backColor: ColorType;
    netColors: ColorType[];
    shape: ShapeType;
    size: SizeType;
    position: PositionType;
    id: number;
    stroopText: string;
    stroopInk: ColorType;
    observerPos: ObserverPos;
}

interface GameHistory {
    date: string;
    score: number;
    accuracy: number;
    maxNBack: number;
}

// --- Constants ---
const ALL_ATTRIBUTES: Attribute[] = ["color", "shape", "size", "position"];
const COLORS: ColorType[] = ["red", "blue", "green"];
const SHAPES: ShapeType[] = ["cube", "sphere", "tetrahedron"];
const SIZES: SizeType[] = ["small", "medium", "large"];
const POSITIONS: PositionType[] = ["left", "center", "right"];
const STROOP_WORDS = ["RED", "BLUE", "GREEN"];

const COLOR_MAP: Record<ColorType, number> = { red: 0xff0000, blue: 0x007bff, green: 0x28a745 };
const CSS_COLOR_MAP: Record<ColorType, string> = { red: "#dc3545", blue: "#007bff", green: "#28a745" };
const SIZE_MAP: Record<SizeType, number> = { small: 0.8, medium: 1.5, large: 2.2 };
const POS_MAP: Record<PositionType, number> = { left: -2.5, center: 0, right: 2.5 };
const INTERVAL_MS = 3500;
const BLOCK_SIZE = 20;

// --- Helper Functions ---
function getHoleTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (ctx) {
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, 256, 256);
        ctx.globalCompositeOperation = "destination-out";
        ctx.beginPath();
        ctx.arc(128, 128, 90, 0, Math.PI * 2);
        ctx.fill();
    }
    return new THREE.CanvasTexture(canvas);
}

function generateCyclicMapping(values: string[]): Record<string, string> {
    let shuffled = [...values];
    let isValid = false;
    while (!isValid) {
        shuffled = [...values].sort(() => Math.random() - 0.5);
        isValid = true;
        for (let i = 0; i < values.length; i++) {
            if (values[i] === shuffled[i]) {
                isValid = false;
                break;
            }
        }
    }
    const map: Record<string, string> = {};
    for (let i = 0; i < values.length; i++) {
        map[values[i]] = shuffled[i];
    }
    return map;
}

// --- Main Component ---
const RFTFluency3D: React.FC = () => {
    // ENFORCED DARK MODE
    const isDark = true;
    const colors = THEME.dark;

    // --- Refs ---
    const containerRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const meshRef = useRef<THREE.Object3D | null>(null);
    const frameIdRef = useRef<number>(0);

    // Logic Refs
    const isSpinningRef = useRef(false);
    const spinStartTimeRef = useRef(0);
    const historyRef = useRef<Stimulus[]>([]);
    const scoreRef = useRef(0);
    const holeTextureRef = useRef<THREE.CanvasTexture | null>(null);
    const turnTimerRef = useRef<number | undefined>(undefined);
    const gameIntervalRef = useRef<number | undefined>(undefined);

    // --- State ---
    const [activeRules, setActiveRules] = useState<Attribute[]>(["color"]);
    const [perspectiveMode, setPerspectiveMode] = useState(false);
    const [perspectiveType, setPerspectiveType] = useState<PerspectiveType>("symbolic");
    const [spatialType, setSpatialType] = useState<SpatialRepType>("rotation");
    const [spatialMatchMode, setSpatialMatchMode] = useState<SpatialMatchMode>("view");
    const [showStroop, setShowStroop] = useState(true);
    const [distractorsEnabled, setDistractorsEnabled] = useState(false);
    const [controlSwapEnabled, setControlSwapEnabled] = useState(false);
    const [useTimer, setUseTimer] = useState(true);
    const [gameDurationSeconds, setGameDurationSeconds] = useState(60);
    const [chartView, setChartView] = useState<"session" | "week" | "month">("session");

    const [isPlaying, setIsPlaying] = useState(false);
    const [score, setScore] = useState(0);
    const [timeLeftSeconds, setTimeLeftSeconds] = useState(gameDurationSeconds);
    const [nBack, setNBack] = useState(1);
    const [autoProgress, setAutoProgress] = useState(true);
    const [currentRule, setCurrentRule] = useState<Attribute>("color");
    const [currentStimulus, setCurrentStimulus] = useState<Stimulus | null>(null);
    const [isSwapped, setIsSwapped] = useState(false);
    const [stimulusHistory, setStimulusHistory] = useState<Stimulus[]>([]);
    void stimulusHistory; 

    const [feedbackMsg, setFeedbackMsg] = useState("");
    const [feedbackColor, setFeedbackColor] = useState("");
    const [levelUpMsg, setLevelUpMsg] = useState("");
    const [showSettings, setShowSettings] = useState(false);
    const [showHistory, setShowHistory] = useState(false);

    // Logic Counters
    const blockTurnCount = useRef(0);
    const blockMistakes = useRef(0);
    const totalMistakes = useRef(0);
    const totalTurns = useRef(0);
    const hasResponded = useRef(false);
    const perspectiveMapping = useRef<Record<string, Record<string, string>>>({});
    const lastStroopText = useRef("");

    // --- Three.js Setup ---
    useEffect(() => {
        if (!containerRef.current) return;

        const scene = new THREE.Scene();
        sceneRef.current = scene;

        // Initial setup with dynamic Z based on aspect ratio
        const aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
        const initialZ = aspect > 1 ? 8.5 : 6; // Push camera back in landscape

        const camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);
        camera.position.z = initialZ;
        cameraRef.current = camera;

        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        containerRef.current.appendChild(renderer.domElement);
        rendererRef.current = renderer;

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(5, 5, 5);
        scene.add(dirLight);

        const animate = () => {
            frameIdRef.current = requestAnimationFrame(animate);
            if (meshRef.current) {
                if (!isSpinningRef.current) {
                    meshRef.current.rotation.x = THREE.MathUtils.lerp(meshRef.current.rotation.x, 0.2, 0.05);
                    meshRef.current.rotation.y = THREE.MathUtils.lerp(meshRef.current.rotation.y, 0, 0.05);
                } else {
                    const elapsed = Date.now() - spinStartTimeRef.current;
                    if (spatialType === "instant") {
                        const delay = 500;
                        const showTime = 600;
                        if (elapsed < delay) meshRef.current.rotation.y = 0;
                        else if (elapsed < delay + showTime) meshRef.current.rotation.y = Math.PI;
                        else {
                            meshRef.current.rotation.y = 0;
                            isSpinningRef.current = false;
                        }
                    } else {
                        const duration = 1500;
                        if (elapsed < duration) {
                            const progress = elapsed / duration;
                            const angle = Math.sin(progress * Math.PI) * Math.PI;
                            meshRef.current.rotation.y = angle;
                        } else {
                            isSpinningRef.current = false;
                            meshRef.current.rotation.y = 0;
                        }
                    }
                }
            }
            renderer.render(scene, camera);
        };

        animate();

        const handleResize = () => {
            if (!containerRef.current || !camera || !renderer) return;
            const width = containerRef.current.clientWidth;
            const height = containerRef.current.clientHeight;
            const newAspect = width / height;
            
            camera.aspect = newAspect;
            // Adjust camera Z position to ensure object fits in landscape mode (mobile landscape)
            // When height is small relative to width, the object appears larger vertically, so we back up.
            camera.position.z = newAspect > 1 ? 8.5 : 6; 
            
            camera.updateProjectionMatrix();
            renderer.setSize(width, height);
        };

        window.addEventListener("resize", handleResize);

        return () => {
            window.removeEventListener("resize", handleResize);
            cancelAnimationFrame(frameIdRef.current);
            if (renderer) renderer.dispose();
            if (holeTextureRef.current) holeTextureRef.current.dispose();
            // Safe remove
            if (containerRef.current && renderer.domElement && containerRef.current.contains(renderer.domElement)) {
                containerRef.current.removeChild(renderer.domElement);
            }
        };
    }, [spatialType]);

    // --- Logic Functions ---

    const scramblePerspectiveRules = () => {
        perspectiveMapping.current = {
            color: generateCyclicMapping(COLORS),
            shape: generateCyclicMapping(SHAPES),
            size: generateCyclicMapping(SIZES),
            position: generateCyclicMapping(POSITIONS),
        };
    };

    const getTransformedValue = (stim: Stimulus, rule: Attribute): any => {
        if (!perspectiveMode) return stim[rule];

        if (perspectiveType === "symbolic") {
            if (stim.observerPos === "me") return stim[rule];
            const rawValue = stim[rule];
            const map = perspectiveMapping.current[rule];
            // @ts-ignore
            return map ? map[rawValue] : rawValue;
        }

        if (perspectiveType === "spatial") {
            if (rule === "position") {
                if (spatialMatchMode === "object") return stim.position;
                if (stim.observerPos === "me") return stim.position;
                if (stim.position === "left") return "right";
                if (stim.position === "right") return "left";
                return "center";
            }
            if (rule === "color") {
                if (spatialMatchMode === "object") {
                    const c = [stim.color, stim.backColor].sort();
                    return c.join("-");
                } else {
                    return stim.observerPos === "me" ? stim.color : stim.backColor;
                }
            }
            return stim[rule];
        }
        return stim[rule];
    };

    const cleanMesh = (obj: THREE.Object3D) => {
        if (obj.children.length > 0) obj.children.forEach(cleanMesh);
        if (obj instanceof THREE.Mesh) {
            if (obj.geometry) obj.geometry.dispose();
            if (Array.isArray(obj.material)) obj.material.forEach((m: any) => m.dispose());
            else if (obj.material) obj.material.dispose();
        }
    };

    const updateMesh = (stim: Stimulus) => {
        if (!sceneRef.current) return;
        if (meshRef.current) {
            sceneRef.current.remove(meshRef.current);
            cleanMesh(meshRef.current);
        }

        const matSettings = { roughness: 0.4, metalness: 0.1 };
        const scale = SIZE_MAP[stim.size];
        const useDualColor = perspectiveMode && perspectiveType === "spatial" && activeRules.includes("color");

        let newMesh: THREE.Object3D;

        if (useDualColor) {
            const matFront = new THREE.MeshStandardMaterial({ ...matSettings, color: COLOR_MAP[stim.color] });
            const matBack = new THREE.MeshStandardMaterial({ ...matSettings, color: COLOR_MAP[stim.backColor] });

            if (spatialType === "cutout") {
                const matInnerBright = new THREE.MeshBasicMaterial({ color: COLOR_MAP[stim.backColor], side: THREE.BackSide });
                const matEdge = new THREE.MeshBasicMaterial({ color: 0x000000 });

                if (stim.shape === "cube") {
                    if (!holeTextureRef.current) holeTextureRef.current = getHoleTexture();
                    const matHole = new THREE.MeshStandardMaterial({ ...matSettings, color: COLOR_MAP[stim.color], alphaMap: holeTextureRef.current, transparent: true, side: THREE.FrontSide });
                    const matSide = new THREE.MeshStandardMaterial({ ...matSettings, color: COLOR_MAP[stim.color] });
                    const outerMesh = new THREE.Mesh(new THREE.BoxGeometry(), [matSide, matSide, matSide, matSide, matHole, matSide]);
                    const innerMesh = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.95, 0.95), matInnerBright);
                    const edgeMesh = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.02, 16, 48), matEdge);
                    edgeMesh.position.z = 0.5;
                    const group = new THREE.Group();
                    group.add(outerMesh, innerMesh, edgeMesh);
                    newMesh = group;
                } else {
                    const outerMesh = new THREE.Mesh(new THREE.SphereGeometry(0.7, 32, 32, 0, Math.PI * 2, 0.6, Math.PI - 0.6), matFront);
                    outerMesh.rotation.x = Math.PI / 2;
                    const innerMesh = new THREE.Mesh(new THREE.SphereGeometry(0.68, 32, 32), matInnerBright);
                    const group = new THREE.Group();
                    group.add(outerMesh, innerMesh);
                    newMesh = group;
                }
                isSpinningRef.current = false;
            } else if (spatialType === "folding") {
                const c = stim.netColors;
                const materials = [3, 1, 0, 4, 2, 5].map(i => new THREE.MeshStandardMaterial({ ...matSettings, color: COLOR_MAP[c[i]] }));
                newMesh = new THREE.Mesh(new THREE.BoxGeometry(), materials);
                isSpinningRef.current = false;
            } else {
                const matSide = new THREE.MeshStandardMaterial({ ...matSettings, color: 0x888888 });
                newMesh = new THREE.Mesh(new THREE.BoxGeometry(), [matSide, matSide, matSide, matSide, matFront, matBack]);
                isSpinningRef.current = true;
                spinStartTimeRef.current = Date.now();
            }
        } else {
            let geo: THREE.BufferGeometry;
            if (stim.shape === "cube") geo = new THREE.BoxGeometry();
            else if (stim.shape === "sphere") geo = new THREE.SphereGeometry(0.7, 32, 32);
            else geo = new THREE.TetrahedronGeometry(1.2);

            if (stim.shape === "tetrahedron") {
                geo.rotateX(-Math.atan(Math.sqrt(2)));
                geo.rotateY(Math.PI / 4);
                geo.rotateZ(Math.PI / 4);
            }
            newMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ ...matSettings, color: COLOR_MAP[stim.color] }));
            isSpinningRef.current = false;
        }

        newMesh.scale.set(scale, scale, scale);
        newMesh.position.x = POS_MAP[stim.position];
        sceneRef.current.add(newMesh);
        meshRef.current = newMesh;
    };

    const generateStimulus = (): Stimulus => {
        const color = COLORS[Math.floor(Math.random() * COLORS.length)];
        let backColor = COLORS[Math.floor(Math.random() * COLORS.length)];
        while (backColor === color) backColor = COLORS[Math.floor(Math.random() * COLORS.length)];

        const netColors = Array(6).fill("").map(() => COLORS[Math.floor(Math.random() * COLORS.length)]);
        netColors[2] = color;
        netColors[5] = backColor;

        const varyShape = activeRules.includes("shape") || distractorsEnabled;
        let shape = varyShape ? SHAPES[Math.floor(Math.random() * SHAPES.length)] : "cube";
        if (perspectiveMode && perspectiveType === "spatial" && spatialType !== "cutout") shape = "cube";
        else if (perspectiveMode && perspectiveType === "spatial" && spatialType === "cutout") shape = Math.random() > 0.5 ? "cube" : "sphere";

        const varySize = activeRules.includes("size") || distractorsEnabled;
        const size = varySize ? SIZES[Math.floor(Math.random() * SIZES.length)] : "medium";

        const varyPos = activeRules.includes("position") || distractorsEnabled;
        const position = varyPos ? POSITIONS[Math.floor(Math.random() * POSITIONS.length)] : "center";

        let stroopText = STROOP_WORDS[Math.floor(Math.random() * STROOP_WORDS.length)];
        if (stroopText === lastStroopText.current) stroopText = STROOP_WORDS[Math.floor(Math.random() * STROOP_WORDS.length)];
        lastStroopText.current = stroopText;

        return {
            color, backColor, netColors, shape, size, position,
            id: Date.now(),
            stroopText,
            stroopInk: COLORS[Math.floor(Math.random() * COLORS.length)],
            observerPos: Math.random() > 0.3 ? "me" : "opposite",
        };
    };

    const flashFeedback = (msg: string, colorClass: string) => {
        setFeedbackMsg(msg);
        setFeedbackColor(colorClass);
        setTimeout(() => setFeedbackMsg(""), 800);
    };

    const checkProgression = () => {
        if (!autoProgress || blockTurnCount.current < BLOCK_SIZE || useTimer) return;
        const accuracy = ((blockTurnCount.current - blockMistakes.current) / blockTurnCount.current) * 100;
        if (accuracy >= 80) {
            setNBack(n => n + 1);
            setLevelUpMsg(`Awesome! Level Up: N=${nBack + 1}`);
            flashFeedback("LEVEL UP!", "text-accent");
        } else if (accuracy < 50 && nBack > 1) {
            setNBack(n => n - 1);
            setLevelUpMsg(`Too fast? Level Down: N=${nBack - 1}`);
            flashFeedback("Level Down", "text-red-500");
        } else {
            setLevelUpMsg(`Maintaining Level: N=${nBack} (${Math.round(accuracy)}%)`);
        }
        setTimeout(() => setLevelUpMsg(""), 3000);
        blockTurnCount.current = 0;
        blockMistakes.current = 0;
    };

    const startTimer = () => {
        if (gameIntervalRef.current) return;
        gameIntervalRef.current = window.setInterval(() => {
            setTimeLeftSeconds(prev => prev - 1);
        }, 1000);
    };

    const nextTurn = useCallback((isReset: boolean = false) => {
        // Check missed target from previous turn
        // FIX: Check !isReset. This ensures we don't check for "missed" targets 
        // when the game is just starting (even if state hasn't cleared yet).
        if (!isReset && historyRef.current.length > nBack && !hasResponded.current) {
            setScore(s => s - 5);
            scoreRef.current -= 5;
            totalMistakes.current++;
            blockMistakes.current++;
            flashFeedback("Too Slow!", "text-red-500");
        }

        checkProgression();

        if (controlSwapEnabled) setIsSwapped(Math.random() < 0.35);
        else setIsSwapped(false);

        const randomIndex = Math.floor(Math.random() * activeRules.length);
        const newRule = activeRules[randomIndex];
        setCurrentRule(newRule);

        const stim = generateStimulus();
        setCurrentStimulus(stim);

        historyRef.current = [...historyRef.current, stim];

        if (useTimer && !gameIntervalRef.current && historyRef.current.length > nBack) {
            startTimer();
        }

        setStimulusHistory([...historyRef.current]);

        updateMesh(stim);

        totalTurns.current++;
        blockTurnCount.current++;
        hasResponded.current = false;

        if (turnTimerRef.current) clearTimeout(turnTimerRef.current);
        turnTimerRef.current = window.setTimeout(nextTurn, INTERVAL_MS);
    }, [activeRules, autoProgress, controlSwapEnabled, distractorsEnabled, nBack, perspectiveMode, perspectiveType, spatialMatchMode, spatialType, useTimer]);

    const startGame = () => {
        if (activeRules.length === 0) {
            flashFeedback("Select Rules!", "text-red-500");
            return;
        }
        if (perspectiveMode) scramblePerspectiveRules();

        setIsPlaying(true);
        setScore(0);
        scoreRef.current = 0;
        historyRef.current = [];
        setStimulusHistory([]);
        setTimeLeftSeconds(gameDurationSeconds);

        totalMistakes.current = 0;
        blockMistakes.current = 0;
        totalTurns.current = 0;
        blockTurnCount.current = 0;
        hasResponded.current = false;

        if (gameIntervalRef.current) clearInterval(gameIntervalRef.current);
        gameIntervalRef.current = undefined;

        nextTurn(true);
    };

    const stopGame = () => {
        setIsPlaying(false);
        if (turnTimerRef.current) clearTimeout(turnTimerRef.current);
        if (gameIntervalRef.current) clearInterval(gameIntervalRef.current);
        gameIntervalRef.current = undefined;
        setLevelUpMsg("");
        flashFeedback("Stopped", "text-accent");
    };

    const endGame = (timedOut: boolean) => {
        if (timedOut && !gameIntervalRef.current) return;
        setIsPlaying(false);
        if (turnTimerRef.current) clearTimeout(turnTimerRef.current);
        if (gameIntervalRef.current) clearInterval(gameIntervalRef.current);
        gameIntervalRef.current = undefined;

        const accuracy = totalTurns.current > 0 ? ((totalTurns.current - totalMistakes.current) / totalTurns.current) * 100 : 0;
        const isSuccess = accuracy >= 80;

        const levelPlayed = nBack;

        if (timedOut && autoProgress && totalTurns.current > 0) {
            if (isSuccess) {
                setNBack(n => n + 1);
                setLevelUpMsg(`TIME UP! SUCCESS! Level Up to ${nBack + 1}`);
                flashFeedback("LEVEL UP!", "text-green-500");
            } else if (nBack > 1 && accuracy < 50) {
                setNBack(n => n - 1);
                setLevelUpMsg(`TIME UP! Level Down to ${nBack - 1}`);
                flashFeedback("Level Down", "text-red-500");
            } else {
                setLevelUpMsg(`TIME UP! Accuracy: ${Math.round(accuracy)}%`);
                flashFeedback("Time Expired", "text-accent");
            }
        } else {
            setLevelUpMsg(`GAME ENDED. Accuracy: ${Math.round(accuracy)}%`);
        }
        setTimeout(() => setLevelUpMsg(""), 5000);
        if (timedOut) saveHistory(accuracy, levelPlayed, scoreRef.current);
    };

    const saveHistory = (accuracy: number, levelPlayed: number, finalScore: number) => {
        const now = new Date();
        const shortDate = `${now.getMonth() + 1}/${now.getDate()} ${now.getHours()}:${now.getMinutes().toString().padStart(2, "0")}`;

        const entry: GameHistory & { timestamp: number } = { // Add timestamp type
            date: shortDate,
            timestamp: Date.now(), // FIX: Save raw time for sorting/grouping
            score: finalScore,
            accuracy,
            maxNBack: levelPlayed,
        };

        const existing = JSON.parse(localStorage.getItem("rft_fluency_3d_history") || "[]");
        existing.push(entry);
        // Removed the limit so you can keep long-term history
        // if (existing.length > 20) existing.shift(); 
        localStorage.setItem("rft_fluency_3d_history", JSON.stringify(existing));
    };

    const handleInput = (action: UserAction) => {
        if (!isPlaying || historyRef.current.length <= nBack || hasResponded.current) return;
        hasResponded.current = true;

        const currentStim = historyRef.current[historyRef.current.length - 1];
        const targetStim = historyRef.current[historyRef.current.length - 1 - nBack];

        const val1 = getTransformedValue(currentStim, currentRule);
        const val2 = getTransformedValue(targetStim, currentRule);

        const isMatch = val1 === val2;
        let correct = false;
        let feedback = "";

        if (action === "match") {
            if (isMatch) { correct = true; feedback = "Correct!"; }
            else { correct = false; feedback = "False Alarm!"; }
        } else {
            if (!isMatch) { correct = true; feedback = "Correct Rejection!"; }
            else { correct = false; feedback = "Miss!"; }
        }

        if (correct) {
            const reactionTime = Date.now() - currentStim.id;
            const speedBonus = Math.max(0, Math.min(10, Math.floor((2000 - reactionTime) / 150)));
            const points = 10 + nBack * 5 + speedBonus;
            setScore(s => s + points);
            scoreRef.current += points;
            if (speedBonus > 5) flashFeedback(`FAST! +${speedBonus}`, "text-green-500");
            else flashFeedback("Correct!", "text-green-500");
        } else {
            totalMistakes.current++;
            blockMistakes.current++;
            setScore(s => s - 5);
            scoreRef.current -= 5;
            flashFeedback(feedback === "Miss!" ? "Missed!" : "Incorrect!", "text-red-500");
        }

        if (turnTimerRef.current) clearTimeout(turnTimerRef.current);
        turnTimerRef.current = window.setTimeout(nextTurn, 500);
    };

    // --- Keyboard & Input Handlers ---
    const handlePhysicalSide = (side: PhysicalSide) => {
        if (!isPlaying) return;
        let action: UserAction;
        // SWAP LOGIC: If swapped, Left=NonMatch(NO), Right=Match(YES).
        // If Normal: Left=Match(YES), Right=NonMatch(NO).
        if (!isSwapped) action = side === "left" ? "match" : "non_match";
        else action = side === "left" ? "non_match" : "match";
        handleInput(action);
    };

    useEffect(() => {
        if (isPlaying && useTimer && timeLeftSeconds <= 0) {
            // We verify gameIntervalRef.current exists to ensure we don't 
            // trigger this multiple times if React re-renders while stopping.
            if (gameIntervalRef.current) {
                endGame(true);
            }
        }
    }, [timeLeftSeconds, isPlaying, useTimer]);

    // Keyboard Event Listener
    // We include key dependencies to prevent stale closures, essentially rebuilding the listener
    // whenever state critical to input handling changes.
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isPlaying) return;
            if (e.code === "ArrowLeft" || e.code === "KeyD") {
                e.preventDefault();
                handlePhysicalSide("left");
            }
            if (e.code === "ArrowRight" || e.code === "KeyJ") {
                e.preventDefault();
                handlePhysicalSide("right");
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isPlaying, isSwapped, currentRule, nBack]);

    // --- Settings Persistence ---
    const loadSettings = () => {
        const savedRules = localStorage.getItem("rft_fluency_3d_rules");
        const savedMode = localStorage.getItem("rft_fluency_3d_perspective");
        const savedType = localStorage.getItem("rft_fluency_3d_persp_type");
        const savedSpatialType = localStorage.getItem("rft_fluency_3d_spatial_type");
        const savedMatchMode = localStorage.getItem("rft_fluency_3d_match_mode");
        const savedDuration = localStorage.getItem("rft_fluency_3d_duration");

        const savedStroop = localStorage.getItem("rft_fluency_3d_stroop");
        const savedDistractors = localStorage.getItem("rft_fluency_3d_distractors");
        const savedSwap = localStorage.getItem("rft_fluency_3d_swap");
        const savedTimerEnabled = localStorage.getItem("rft_fluency_3d_timer_enabled");

        if (savedMode) setPerspectiveMode(savedMode === "true");
        if (savedType) setPerspectiveType(savedType as PerspectiveType);
        if (savedSpatialType) setSpatialType(savedSpatialType as SpatialRepType);
        if (savedMatchMode) setSpatialMatchMode(savedMatchMode as SpatialMatchMode);
        if (savedRules) {
            try {
                const parsed = JSON.parse(savedRules);
                if (Array.isArray(parsed) && parsed.length > 0) setActiveRules(parsed);
            } catch (e) { }
        }
        if (savedDuration) setGameDurationSeconds(parseInt(savedDuration));

        if (savedStroop) setShowStroop(savedStroop === "true");
        if (savedDistractors) setDistractorsEnabled(savedDistractors === "true");
        if (savedSwap) setControlSwapEnabled(savedSwap === "true");
        if (savedTimerEnabled) setUseTimer(savedTimerEnabled === "true");
    };

    const updateSettings = () => {
        localStorage.setItem("rft_fluency_3d_rules", JSON.stringify(activeRules));
        localStorage.setItem("rft_fluency_3d_perspective", String(perspectiveMode));
        localStorage.setItem("rft_fluency_3d_persp_type", perspectiveType);
        localStorage.setItem("rft_fluency_3d_spatial_type", spatialType);
        localStorage.setItem("rft_fluency_3d_match_mode", spatialMatchMode);
        localStorage.setItem("rft_fluency_3d_duration", String(gameDurationSeconds));
        localStorage.setItem("rft_fluency_3d_stroop", String(showStroop));
        localStorage.setItem("rft_fluency_3d_distractors", String(distractorsEnabled));
        localStorage.setItem("rft_fluency_3d_swap", String(controlSwapEnabled));
        localStorage.setItem("rft_fluency_3d_timer_enabled", String(useTimer));
    };

    const toggleRule = (rule: Attribute) => {
        if (perspectiveMode && perspectiveType === "spatial" && (rule === "shape" || rule === "size")) return;
        let newRules = activeRules.includes(rule)
            ? activeRules.filter(r => r !== rule)
            : [...activeRules, rule];
        if (newRules.length === 0) newRules = activeRules.length > 0 ? activeRules : ["color"];
        setActiveRules(newRules);
        localStorage.setItem("rft_fluency_3d_rules", JSON.stringify(newRules));
    };

    useEffect(() => {
        loadSettings();
        return () => stopGame();
        // eslint-disable-next-line
    }, []);

    const chartData = useMemo(() => {
        if (!showHistory) return null;
        const rawHistory = JSON.parse(localStorage.getItem("rft_fluency_3d_history") || "[]");
        
        // Helper to handle old data that might not have a timestamp yet
        const getTs = (h: any) => h.timestamp || Date.now(); 

        let processedLabels: string[] = [];
        let processedScores: number[] = [];
        let processedNBack: number[] = [];

        if (chartView === "session") {
            // Take only last 50 for readability in session view
            const slice = rawHistory.slice(-50);
            processedLabels = slice.map((h: any) => h.date);
            processedScores = slice.map((h: any) => h.score);
            processedNBack = slice.map((h: any) => h.maxNBack);
        } 
        else {
            // --- AGGREGATION LOGIC ---
            const groups: Record<string, { totalScore: number; totalNBack: number; count: number }> = {};

            rawHistory.forEach((h: any) => {
                const date = new Date(getTs(h));
                let key = "";

                if (chartView === "month") {
                    // Key: "Nov 2023"
                    key = date.toLocaleString('default', { month: 'short', year: 'numeric' });
                } else if (chartView === "week") {
                    // Key: "Week 48, 2023"
                    const startOfYear = new Date(date.getFullYear(), 0, 1);
                    const days = Math.floor((date.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
                    const weekNum = Math.ceil((days + 1) / 7);
                    key = `W${weekNum} '${date.getFullYear().toString().substr(-2)}`;
                }

                if (!groups[key]) groups[key] = { totalScore: 0, totalNBack: 0, count: 0 };
                groups[key].totalScore += h.score;
                groups[key].totalNBack += h.maxNBack;
                groups[key].count++;
            });

            processedLabels = Object.keys(groups);
            processedScores = Object.values(groups).map((g: any) => Math.round(g.totalScore / g.count)); // Average Score
            processedNBack = Object.values(groups).map((g: any) => parseFloat((g.totalNBack / g.count).toFixed(1))); // Average N-Back
        }

        return {
            labels: processedLabels,
            datasets: [
                {
                    label: 'Avg Score',
                    data: processedScores,
                    borderColor: COMMON.target,
                    tension: 0.3, // Smoother line for trends
                    yAxisID: 'y',
                    pointRadius: 4,
                },
                {
                    label: 'Avg N-Back',
                    data: processedNBack,
                    borderColor: COMMON.accent,
                    borderDash: [5, 5],
                    tension: 0.3,
                    yAxisID: 'y1',
                    pointRadius: 0,
                }
            ]
        };
    }, [showHistory, chartView]);

    return (
        <div className="absolute inset-0 overflow-hidden flex items-center justify-center transition-colors duration-300"
            style={{ color: colors.text }}>

            {/* MAIN GAME CONTAINER WITH BORDER */}
            <div className="relative w-[95%] h-[90%] rounded-3xl border-4 overflow-hidden shadow-2xl flex flex-col"
                style={{ borderColor: colors.border, backgroundColor: colors.bg }}>

                {/* HEADER (Inside Container) */}
                <div className="absolute top-6 left-8 z-50">
                </div>

                {/* THREE JS LAYER */}
                <div ref={containerRef} className="absolute inset-0 z-0" />

                {/* STROOP OVERLAY */}
                {isPlaying && currentStimulus && showStroop && (
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-8xl md:text-8xl text-6xl font-black opacity-35 z-10 pointer-events-none tracking-widest select-none"
                        style={{ color: CSS_COLOR_MAP[currentStimulus.stroopInk] }}>
                        {currentStimulus.stroopText}
                    </div>
                )}

                {/* UI LAYER */}
                <div className="absolute inset-0 z-10 pointer-events-none">

                    {/* HUD */}
                    <div className="absolute top-6 z-30 left-1/2 -translate-x-1/2 flex items-center gap-4 md:gap-6 px-4 md:px-6 py-2 md:py-3 rounded-xl shadow-lg border pointer-events-auto backdrop-blur-md transition-all duration-300 max-w-full origin-top scale-90 md:scale-100 landscape:scale-[0.80] landscape:origin-top"
                        style={{ backgroundColor: isDark ? 'rgba(30, 41, 59, 0.8)' : 'rgba(255, 255, 255, 0.8)', borderColor: colors.border }}>

                        <div className="flex gap-4 md:gap-6 pr-4 md:pr-6 border-r" style={{ borderColor: colors.border }}>
                            <div className="flex flex-col items-center">
                                <span className="text-[0.65rem] uppercase font-bold tracking-wider" style={{ color: COMMON.dim }}>Rule</span>
                                <span className="text-lg md:text-xl font-bold" style={{ color: COMMON.accent }}>{currentRule.toUpperCase()}</span>
                            </div>
                            <div className="flex flex-col items-center">
                                <span className="text-[0.65rem] uppercase font-bold tracking-wider" style={{ color: COMMON.dim }}>Score</span>
                                <span className="text-lg md:text-xl font-bold">{score}</span>
                            </div>
                        </div>

                        {useTimer && (
                            <div className="flex flex-col items-center">
                                <span className="text-[0.65rem] uppercase font-bold tracking-wider" style={{ color: COMMON.dim }}>Time</span>
                                <span className="text-lg md:text-xl font-bold text-orange-500">
                                    {Math.floor(timeLeftSeconds / 60)}:{(timeLeftSeconds % 60).toString().padStart(2, '0')}
                                </span>
                            </div>
                        )}

                        {/* CLUES */}
                        {isPlaying && perspectiveMode && currentStimulus && (
                            <div className={`flex flex-col items-center justify-center px-4 py-2 border-2 rounded-lg min-w-[120px] md:min-w-[140px] animate-pulse ${perspectiveType === 'spatial' ? 'border-[#9c27b0]' : 'border-[#0ea5e9]'}`}
                                style={{ backgroundColor: isDark ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.5)' }}>
                                <div className="text-[0.6rem] font-bold uppercase tracking-wider mb-1" style={{ color: COMMON.dim }}>
                                    {perspectiveType === 'symbolic' ? 'Symbolic Key' : (spatialMatchMode === 'object' ? 'Object Constancy' : 'Seat Position')}
                                </div>
                                {perspectiveType === 'symbolic' ? (
                                    <>
                                        <div className="text-lg font-black" style={{ color: COMMON.accent }}>
                                            {currentStimulus.observerPos === 'me' ? currentStimulus[currentRule].toUpperCase() : 'DECODE'}
                                        </div>
                                        <div className="text-[0.6rem] italic opacity-80">
                                            {currentStimulus.observerPos === 'me' ? '(Match What You See)' : '(Use Key)'}
                                        </div>
                                    </>
                                ) : spatialMatchMode === 'object' ? (
                                    <>
                                        <div className="text-lg font-black" style={{ color: COMMON.purple }}>PAIR</div>
                                        <div className="text-[0.6rem] italic opacity-80">(Match Cube Pair)</div>
                                    </>
                                ) : (
                                    <>
                                        <div className="text-lg font-black" style={{ color: COMMON.purple }}>{currentStimulus.observerPos.toUpperCase()}</div>
                                        <div className="text-[0.6rem] italic opacity-80">
                                            {currentStimulus.observerPos === 'opposite' ? '(Match Their View)' : '(Match Your View)'}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        <div className="flex items-center gap-4 pl-4 border-l" style={{ borderColor: colors.border }}>
                            <div className="flex flex-col items-center">
                                <span className="text-[0.65rem] uppercase font-bold tracking-wider mb-1" style={{ color: COMMON.dim }}>N-Back: {nBack}</span>
                                <div className="flex gap-1">
                                    <button className="px-2 py-0.5 text-xs border rounded bg-opacity-50 hover:bg-opacity-100 disabled:opacity-30"
                                        disabled={autoProgress} onClick={() => setNBack(n => Math.max(1, n - 1))}>-</button>
                                    <button className="px-2 py-0.5 text-xs border rounded bg-opacity-50 hover:bg-opacity-100 disabled:opacity-30"
                                        disabled={autoProgress} onClick={() => setNBack(n => n + 1)}>+</button>
                                </div>
                            </div>

                            <div className="flex flex-col items-center cursor-pointer">
                                <input type="checkbox" checked={autoProgress} onChange={(e) => setAutoProgress(e.target.checked)} className="mb-1 accent-sky-500" />
                                <span className="text-[0.5rem] uppercase font-bold">Auto</span>
                            </div>

                            {!isPlaying ? (
                                <>
                                    <button onClick={startGame} className="px-4 py-2 rounded-lg font-bold text-white shadow-lg transform hover:scale-105 transition-all" style={{ backgroundColor: COMMON.accent }}>
                                        Start
                                    </button>
                                    <button onClick={() => setShowSettings(true)} className="px-3 py-2 rounded-lg font-semibold text-sm border hover:bg-black/5" style={{ borderColor: colors.border }}>
                                        Config
                                    </button>
                                    <button onClick={() => setShowHistory(true)} className="px-3 py-2 rounded-lg font-semibold text-sm border hover:bg-black/5" style={{ borderColor: colors.border }}>
                                        Stats
                                    </button>
                                </>
                            ) : (
                                <button onClick={stopGame} className="px-4 py-2 rounded-lg font-bold text-white shadow-lg bg-red-500 hover:bg-red-600">
                                    Stop
                                </button>
                            )}
                        </div>
                    </div>

                    {/* FOLDING NET KEY */}
                    {isPlaying && perspectiveMode && currentStimulus && perspectiveType === "spatial" && spatialType === "folding" && (
                        <div className="absolute top-28 left-8 z-50 p-3 rounded-xl border-2 shadow-xl animate-[pulse_3s_infinite]"
                            style={{ backgroundColor: colors.surface, borderColor: COMMON.purple, color: colors.text }}>
                            <div className="text-[0.6rem] font-bold text-center mb-2 tracking-wider">MENTAL FOLD KEY</div>
                            <div className="flex flex-col gap-[2px]">
                                <div className="flex justify-center gap-[2px]">
                                    <div className="w-6 h-6" />
                                    <div className="w-6 h-6 border rounded-sm" style={{ backgroundColor: CSS_COLOR_MAP[currentStimulus.netColors[0]] }} />
                                    <div className="w-6 h-6" />
                                </div>
                                <div className="flex justify-center gap-[2px]">
                                    <div className="w-6 h-6 border rounded-sm" style={{ backgroundColor: CSS_COLOR_MAP[currentStimulus.netColors[1]] }} />
                                    <div className="w-6 h-6 border-2 border-white rounded-sm flex items-center justify-center text-white text-xs font-black shadow-inner"
                                        style={{ backgroundColor: CSS_COLOR_MAP[currentStimulus.netColors[2]] }}>F</div>
                                    <div className="w-6 h-6 border rounded-sm" style={{ backgroundColor: CSS_COLOR_MAP[currentStimulus.netColors[3]] }} />
                                </div>
                                <div className="flex justify-center gap-[2px]">
                                    <div className="w-6 h-6" />
                                    <div className="w-6 h-6 border rounded-sm" style={{ backgroundColor: CSS_COLOR_MAP[currentStimulus.netColors[4]] }} />
                                    <div className="w-6 h-6" />
                                </div>
                                <div className="flex justify-center gap-[2px]">
                                    <div className="w-6 h-6" />
                                    <div className="w-6 h-6 border rounded-sm" style={{ backgroundColor: CSS_COLOR_MAP[currentStimulus.netColors[5]] }} />
                                    <div className="w-6 h-6" />
                                </div>
                            </div>
                            <div className={`text-[0.6rem] mt-2 text-center font-bold italic ${currentStimulus.observerPos === 'opposite' ? 'text-red-500' : ''}`}>
                                {currentStimulus.observerPos === 'opposite' ? 'FIND BACK FACE!' : 'USE FRONT FACE'}
                            </div>
                        </div>
                    )}

                    {/* THEMED AVATAR INDICATORS */}
                    {isPlaying && perspectiveMode && currentStimulus && (
                        <>
                            {currentStimulus.observerPos === 'opposite' ? (
                                <div className="absolute top-[18%] landscape:top-24 left-1/2 -translate-x-1/2 flex flex-col items-center animate-[slideDown_0.5s_ease-out]">
                                    <svg viewBox="0 0 100 100" className="drop-shadow-lg w-12 h-12 md:w-20 md:h-20 landscape:w-10 landscape:h-10">
                                        <path d="M 10 0 Q 50 80 90 0" fill={colors.avatarFill} />
                                        <circle cx="50" cy="60" r="30" fill={isDark ? '#6b6b6b94' : '#04333aff'} />
                                    </svg>
                                    <div className="px-2 py-0.5 bg-white text-black font-black text-xs rounded mt-[-5px] md:mt-[-10px] shadow">THEM</div>
                                </div>
                            ) : (
                                <div className="absolute bottom-4 landscape:bottom-2 left-1/2 -translate-x-1/2 flex flex-col items-center animate-[slideUp_0.5s_ease-out] pb-4 landscape:pb-0">
                                    <svg viewBox="0 0 100 100" className="drop-shadow-lg w-12 h-12 md:w-20 md:h-20 landscape:w-10 landscape:h-10">
                                        <path d="M 10 100 Q 50 20 90 100" fill={colors.avatarFill} />
                                        <circle cx="50" cy="40" r="30" fill={isDark ? '#62626294' : '#3a0404ff'} />
                                    </svg>
                                    <div className="px-2 py-0.5 bg-white text-black font-black text-xs rounded mt-[-5px] md:mt-[-10px] shadow z-20">ME</div>
                                </div>
                            )}
                        </>
                    )}

                    {/* FEEDBACK & TOASTS */}
                    {levelUpMsg && (
                        <div className="absolute top-[120px] left-1/2 -translate-x-1/2 px-6 py-2 rounded-full font-bold shadow-lg animate-[slideDown_0.3s_ease-out] z-50 whitespace-nowrap"
                            style={{ backgroundColor: colors.surface, color: colors.text }}>
                            {levelUpMsg}
                        </div>
                    )}
                    {feedbackMsg && (
                        <div className={`absolute top-[40%] left-1/2 -translate-x-1/2 -translate-y-1/2 text-6xl font-black drop-shadow-xl z-50 animate-[popIn_0.2s_ease-out] whitespace-nowrap
                                ${feedbackColor.includes('green') ? 'text-green-500' : feedbackColor.includes('red') ? 'text-red-500' : 'text-blue-500'}`}>
                            {feedbackMsg}
                        </div>
                    )}

                    {/* TAP ZONES */}
                    {isPlaying && (
                        <>
                            <div onClick={() => handlePhysicalSide('left')}
                                className="absolute bottom-0 left-0 w-1/2 h-[50%] flex justify-center items-center cursor-pointer pointer-events-auto hover:bg-white/5 border-r border-white/10 transition-colors">
                                <div className={`w-20 h-20 md:w-24 md:h-24 landscape:w-16 landscape:h-16 rounded-full flex flex-col items-center justify-center text-xl font-black text-white shadow-[0_0_20px_rgba(0,0,0,0.3)] border-4 mx-auto landscape:mx-0
                                        ${isSwapped ? 'bg-red-500/80 border-red-500' : 'bg-green-500/80 border-green-500'}`}>
                                    <span>{isSwapped ? 'NO' : 'YES'}</span>
                                    <span className="text-[0.6rem] font-normal opacity-80 mt-1">D / ←</span>
                                </div>
                            </div>
                            <div onClick={(e) => { e.preventDefault(); handlePhysicalSide('right'); }} onContextMenu={(e) => e.preventDefault()}
                                className="absolute bottom-0 right-0 w-1/2 h-[50%] flex justify-center items-center cursor-pointer pointer-events-auto hover:bg-white/5 transition-colors">
                                <div className={`w-20 h-20 md:w-24 md:h-24 landscape:w-16 landscape:h-16 rounded-full flex flex-col items-center justify-center text-xl font-black text-white shadow-[0_0_20px_rgba(0,0,0,0.3)] border-4 mx-auto landscape:mx-0
                                        ${isSwapped ? 'bg-green-500/80 border-green-500' : 'bg-red-500/80 border-red-500'}`}>
                                    <span>{isSwapped ? 'YES' : 'NO'}</span>
                                    <span className="text-[0.6rem] font-normal opacity-80 mt-1">J / →</span>
                                </div>
                            </div>
                        </>
                    )}

                    {/* SETTINGS MODAL */}
                    {showSettings && (
                        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center pointer-events-auto">
                            <div className="w-[90%] max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl p-6 shadow-2xl border"
                                style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
                                <h2 className="text-2xl font-black mb-6 border-b pb-2" style={{ borderColor: colors.border }}>Configuration</h2>

                                {/* Timer Section */}
                                <div className="mb-6">
                                    <h3 className="text-xs font-bold uppercase tracking-wider mb-3 opacity-70">Session Timer</h3>
                                    <label className="flex items-center gap-3 mb-3 cursor-pointer p-3 rounded-lg border hover:bg-black/5 transition" style={{ borderColor: colors.border }}>
                                        <input type="checkbox" checked={useTimer} onChange={(e) => setUseTimer(e.target.checked)} className="w-5 h-5 accent-sky-500" />
                                        <div>
                                            <div className="font-bold">Enable Timer</div>
                                            <div className="text-xs opacity-70">Required for history tracking</div>
                                        </div>
                                    </label>
                                    {useTimer && (
                                        <div className="flex items-center gap-4 pl-2">
                                            <span className="text-sm font-semibold">Duration:</span>
                                            <div className="flex items-center gap-2">
                                                <input type="number" min="0" className="w-16 p-2 rounded border text-center font-bold bg-transparent"
                                                    value={Math.floor(gameDurationSeconds / 60)}
                                                    onChange={(e) => setGameDurationSeconds(parseInt(e.target.value) * 60 + (gameDurationSeconds % 60))}
                                                    style={{ borderColor: colors.border }} />
                                                <span className="text-xs uppercase">min</span>
                                            </div>
                                            <span className="font-bold">:</span>
                                            <div className="flex items-center gap-2">
                                                <input type="number" min="0" max="59" className="w-16 p-2 rounded border text-center font-bold bg-transparent"
                                                    value={gameDurationSeconds % 60}
                                                    onChange={(e) => setGameDurationSeconds(Math.floor(gameDurationSeconds / 60) * 60 + parseInt(e.target.value))}
                                                    style={{ borderColor: colors.border }} />
                                                <span className="text-xs uppercase">sec</span>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Active Frames */}
                                <div className="mb-6">
                                    <h3 className="text-xs font-bold uppercase tracking-wider mb-3 opacity-70">Active Attributes</h3>
                                    <div className="grid grid-cols-2 gap-3">
                                        {ALL_ATTRIBUTES.map(rule => (
                                            <label key={rule} className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition
                                        ${activeRules.includes(rule) ? 'bg-sky-500/10 border-sky-500' : 'hover:bg-black/5'}
                                        ${(perspectiveMode && perspectiveType === 'spatial' && (rule === 'shape' || rule === 'size')) ? 'opacity-40 pointer-events-none bg-gray-100 dark:bg-gray-800' : ''}`}
                                                style={{ borderColor: activeRules.includes(rule) ? COMMON.accent : colors.border }}>
                                                <input type="checkbox" checked={activeRules.includes(rule)} onChange={() => toggleRule(rule)} className="w-4 h-4 accent-sky-500" />
                                                <span className="font-bold text-sm uppercase">{rule}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                {/* Distractors */}
                                <div className="mb-6">
                                    <h3 className="text-xs font-bold uppercase tracking-wider mb-3 opacity-70">Difficulty Modifiers</h3>
                                    <div className="space-y-2">
                                        <label className="flex items-center gap-3 p-3 rounded-lg border hover:bg-black/5 cursor-pointer" style={{ borderColor: colors.border }}>
                                            <input type="checkbox" checked={showStroop} onChange={(e) => setShowStroop(e.target.checked)} className="w-5 h-5 accent-sky-500" />
                                            <span className="font-bold text-sm">Stroop Overlay (Text)</span>
                                        </label>
                                        <label className="flex items-center gap-3 p-3 rounded-lg border hover:bg-black/5 cursor-pointer" style={{ borderColor: colors.border }}>
                                            <input type="checkbox" checked={distractorsEnabled} onChange={(e) => setDistractorsEnabled(e.target.checked)} className="w-5 h-5 accent-sky-500" />
                                            <div>
                                                <div className="font-bold text-sm">Visual Noise</div>
                                                <div className="text-xs opacity-70">Vary unused features</div>
                                            </div>
                                        </label>
                                        <label className="flex items-center gap-3 p-3 rounded-lg border hover:bg-black/5 cursor-pointer" style={{ borderColor: colors.border }}>
                                            <input type="checkbox" checked={controlSwapEnabled} onChange={(e) => setControlSwapEnabled(e.target.checked)} className="w-5 h-5 accent-sky-500" />
                                            <div>
                                                <div className="font-bold text-sm">Control Swap</div>
                                                <div className="text-xs opacity-70">Randomly flip YES/NO sides</div>
                                            </div>
                                        </label>
                                    </div>
                                </div>

                                {/* Perspective */}
                                <div className="mb-6">
                                    <h3 className="text-xs font-bold uppercase tracking-wider mb-3 opacity-70">Perspective Taking</h3>
                                    <label className="flex items-center gap-3 p-3 rounded-lg border hover:bg-black/5 cursor-pointer mb-4" style={{ borderColor: colors.border }}>
                                        <input type="checkbox" checked={perspectiveMode} onChange={(e) => setPerspectiveMode(e.target.checked)} className="w-5 h-5 accent-sky-500" />
                                        <span className="font-bold">Enable Perspective</span>
                                    </label>

                                    {perspectiveMode && (
                                        <div className="pl-4 border-l-2 ml-4 space-y-4" style={{ borderColor: COMMON.accent }}>
                                            <div>
                                                <span className="text-xs font-bold opacity-70 block mb-2">Type:</span>
                                                <div className="flex gap-2">
                                                    <button onClick={() => setPerspectiveType('symbolic')}
                                                        className={`px-3 py-1.5 rounded text-sm font-bold border transition ${perspectiveType === 'symbolic' ? 'bg-sky-500 text-white border-sky-500' : 'hover:bg-black/5'}`}
                                                        style={{ borderColor: colors.border }}>
                                                        Symbolic
                                                    </button>
                                                    <button onClick={() => { setPerspectiveType('spatial'); setSpatialMatchMode('view'); }}
                                                        className={`px-3 py-1.5 rounded text-sm font-bold border transition ${perspectiveType === 'spatial' ? 'bg-sky-500 text-white border-sky-500' : 'hover:bg-black/5'}`}
                                                        style={{ borderColor: colors.border }}>
                                                        Spatial
                                                    </button>
                                                </div>
                                            </div>

                                            {perspectiveType === 'spatial' && (
                                                <>
                                                    <div>
                                                        <span className="text-xs font-bold opacity-70 block mb-2">Strategy:</span>
                                                        <div className="flex gap-2">
                                                            <button onClick={() => setSpatialMatchMode('view')}
                                                                className={`px-3 py-1.5 rounded text-sm font-bold border transition ${spatialMatchMode === 'view' ? 'bg-purple-600 text-white border-purple-600' : 'hover:bg-black/5'}`}
                                                                style={{ borderColor: colors.border }}>
                                                                Observer View
                                                            </button>
                                                            <button onClick={() => setSpatialMatchMode('object')}
                                                                className={`px-3 py-1.5 rounded text-sm font-bold border transition ${spatialMatchMode === 'object' ? 'bg-purple-600 text-white border-purple-600' : 'hover:bg-black/5'}`}
                                                                style={{ borderColor: colors.border }}>
                                                                Object Identity
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div>
                                                        <span className="text-xs font-bold opacity-70 block mb-2">Visualization:</span>
                                                        <div className="flex flex-wrap gap-2">
                                                            {['rotation', 'instant', 'folding', 'cutout'].map(t => (
                                                                <button key={t} onClick={() => setSpatialType(t as any)}
                                                                    className={`px-2 py-1 rounded text-xs font-bold border capitalize transition ${spatialType === t ? 'bg-gray-600 text-white border-gray-600' : 'hover:bg-black/5'}`}
                                                                    style={{ borderColor: colors.border }}>
                                                                    {t}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>

                                <button onClick={() => { updateSettings(); setShowSettings(false); }} className="w-full py-3 rounded-xl font-bold text-white text-lg shadow-lg hover:brightness-110 transition"
                                    style={{ backgroundColor: COMMON.accent }}>
                                    Done
                                </button>
                            </div>
                        </div>
                    )}

                    {/* HISTORY MODAL */}
                    {showHistory && (
                        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center pointer-events-auto">
                            <div className="w-[90%] max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl p-6 shadow-2xl border"
                                style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
                                
                                <div className="flex justify-between items-center mb-6">
                                    <h2 className="text-2xl font-black">Progress</h2>
                                    
                                    {/* VIEW TOGGLES */}
                                    <div className="flex bg-black/10 rounded-lg p-1 gap-1">
                                        {['session', 'week', 'month'].map((view) => (
                                            <button
                                                key={view}
                                                onClick={() => setChartView(view as any)}
                                                className={`px-3 py-1 rounded-md text-xs font-bold uppercase transition-all ${
                                                    chartView === view 
                                                    ? 'bg-white text-black shadow-sm' 
                                                    : 'text-gray-500 hover:text-gray-700'
                                                }`}
                                            >
                                                {view}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="h-[300px] w-full">
                                    {chartData && <Line data={chartData} options={{
                                        responsive: true,
                                        maintainAspectRatio: false,
                                        interaction: { mode: 'index', intersect: false },
                                        scales: {
                                            x: { 
                                                ticks: { maxTicksLimit: 12, color: COMMON.dim },
                                                grid: { color: colors.grid }
                                            },
                                            y: { 
                                                type: 'linear', 
                                                display: true, 
                                                position: 'left', 
                                                title: { display: true, text: 'Score', color: COMMON.dim },
                                                ticks: { color: COMMON.dim },
                                                grid: { color: colors.grid }
                                            },
                                            y1: { 
                                                type: 'linear', 
                                                display: true, 
                                                position: 'right', 
                                                min: 0, 
                                                max: 10, 
                                                grid: { drawOnChartArea: false }, 
                                                title: { display: true, text: 'Avg Level', color: COMMON.dim },
                                                ticks: { color: COMMON.dim }
                                            }
                                        },
                                        plugins: {
                                            legend: {
                                                labels: { color: colors.text }
                                            }
                                        }
                                    }} />}
                                </div>
                                
                                <div className="mt-4 text-center opacity-50 text-xs italic">
                                    {chartView === 'session' ? 'Showing last 50 games' : `Showing averages per ${chartView}`}
                                </div>

                                <button onClick={() => setShowHistory(false)} className="mt-6 w-full py-2 rounded-lg font-bold border hover:bg-black/5" style={{ borderColor: colors.border }}>Close</button>
                            </div>
                        </div>
                    )}

                </div>
            </div>
            <style>{`
        @keyframes slideDown { from { transform: translate(-50%, -20px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
        @keyframes slideUp { from { transform: translate(-50%, 20px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
        @keyframes popIn { from { transform: translate(-50%, -50%) scale(0.5); opacity: 0; } to { transform: translate(-50%, -50%) scale(1); opacity: 1; } }
      `}</style>
        </div>
    );
};

export default RFTFluency3D;