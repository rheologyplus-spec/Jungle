import {
  ArrowLeft,
  CircleHelp,
  Flag,
  Lightbulb,
  Pause,
  PawPrint,
  Play,
  RotateCcw,
  Trophy,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ANIMALS,
  FIND_TIME_BONUS,
  GRID_SIZE,
  ROUND_SECONDS,
  blankBoard,
  createBoard,
  createPreviewBoard,
  revealAnimal,
  type Cell,
} from "./game";

type Phase = "start" | "playing" | "paused" | "won" | "lost";
type Sound = "start" | "find" | "miss" | "mark" | "hint" | "pause" | "win" | "lose";
type Burst = { id: number; index: number; label: string; kind: "find" | "miss" | "win" };

type GameState = {
  phase: Phase;
  board: Cell[];
  started: boolean;
  found: number;
  score: number;
  streak: number;
  probes: number;
  timeLeft: number;
  hintsUsed: number;
  lastFoundIndex: number | null;
};

type HighScore = {
  id: string;
  name: string;
  score: number;
  found: number;
  won: boolean;
  date: number;
};

const SCORES_KEY = "radpa-scores-v1";
const NAME_KEY = "radpa-player-v1";
const SOUND_KEY = "radpa-sound-v1";
const PREVIEW_BOARD = createPreviewBoard();
const DIGITS = "۰۱۲۳۴۵۶۷۸۹";

function fa(value: number): string {
  return new Intl.NumberFormat("fa-IR").format(value);
}

function clock(seconds: number): string {
  const safe = Math.max(0, seconds);
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`.replace(
    /\d/g,
    (digit) => DIGITS[Number(digit)],
  );
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The game remains playable when storage is unavailable.
  }
}

function animateBoard(element: HTMLDivElement | null, frames: Keyframe[], options: KeyframeAnimationOptions): void {
  if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  element.animate(frames, options);
}

function readScores(): HighScore[] {
  try {
    const parsed: unknown = JSON.parse(readStored(SCORES_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is HighScore =>
          typeof entry === "object" &&
          entry !== null &&
          typeof entry.name === "string" &&
          typeof entry.score === "number" &&
          typeof entry.id === "string",
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  } catch {
    return [];
  }
}

function newGame(phase: Phase = "start"): GameState {
  return {
    phase,
    board: blankBoard(),
    started: false,
    found: 0,
    score: 0,
    streak: 0,
    probes: 0,
    timeLeft: ROUND_SECONDS,
    hintsUsed: 0,
    lastFoundIndex: null,
  };
}

function AnimalPortrait({ id, className = "" }: { id: number; className?: string }) {
  const style = {
    "--portrait-x": `${((id % 4) / 3) * 100}%`,
    "--portrait-y": `${Math.floor(id / 4) * 100}%`,
  } as CSSProperties;

  return <span className={`animal-portrait ${className}`} style={style} aria-hidden="true" />;
}

function BurstEffect({ burst }: { burst: Burst }) {
  const count = burst.kind === "win" ? 28 : burst.kind === "find" ? 16 : 5;
  const x = ((burst.index % GRID_SIZE) + 0.5) * 10;
  const y = (Math.floor(burst.index / GRID_SIZE) + 0.5) * 10;

  return (
    <div className={`burst burst--${burst.kind}`} style={{ left: `${x}%`, top: `${y}%` }}>
      {Array.from({ length: count }, (_, index) => {
        const style = {
          "--angle": `${(360 / count) * index + (index % 2) * 9}deg`,
          "--distance": `${-(burst.kind === "win" ? 75 + (index % 4) * 17 : burst.kind === "find" ? 30 + (index % 4) * 11 : 19 + index * 3)}px`,
          "--particle-delay": `${(index % 4) * 25}ms`,
        } as CSSProperties;
        return <i key={index} className="burst-particle" style={style} />;
      })}
      {burst.label && <span className="burst-label">{burst.label}</span>}
    </div>
  );
}

function Leaderboard({ scores }: { scores: HighScore[] }) {
  return (
    <section className="leaderboard" aria-label="جدول رکوردهای محلی">
      <div className="leaderboard-heading">
        <div>
          <span className="overline">LOCAL HALL OF FAME</span>
          <h3>بهترین کاوشگرها</h3>
        </div>
        <Trophy size={21} strokeWidth={1.8} aria-hidden="true" />
      </div>
      {scores.length === 0 ? (
        <p className="leaderboard-empty">هنوز رکوردی اینجا نیست. اولین کاوشگر باش!</p>
      ) : (
        <ol className="leaderboard-list">
          {scores.map((entry, index) => (
            <li key={entry.id}>
              <span className="leaderboard-rank">{String(index + 1).padStart(2, "0")}</span>
              <span className="leaderboard-name">{entry.name}</span>
              <strong>{fa(entry.score)}</strong>
            </li>
          ))}
        </ol>
      )}
      <span className="leaderboard-caption">رکوردها فقط روی همین دستگاه ذخیره می‌شوند.</span>
    </section>
  );
}

export default function App() {
  const [game, setGame] = useState<GameState>(() => newGame());
  const gameRef = useRef(game);
  const [highScores, setHighScores] = useState<HighScore[]>(readScores);
  const highScoresRef = useRef(highScores);
  const [playerName, setPlayerName] = useState(() => readStored(NAME_KEY) ?? "");
  const currentPlayerRef = useRef(playerName.trim() || "کاوشگر");
  const [soundOn, setSoundOn] = useState(() => readStored(SOUND_KEY) !== "off");
  const [message, setMessage] = useState("اول بازی را شروع کن؛ جنگل منتظر توست.");
  const [selectedCell, setSelectedCell] = useState(44);
  const [flagMode, setFlagMode] = useState(false);
  const [hintIndex, setHintIndex] = useState<number | null>(null);
  const [scanIndex, setScanIndex] = useState<number | null>(null);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [endVisible, setEndVisible] = useState(false);
  const [runRank, setRunRank] = useState<number | null>(null);
  const [newRecord, setNewRecord] = useState(false);

  const deadlineRef = useRef<number | null>(null);
  const pausedRemainingRef = useRef(ROUND_SECONDS * 1000);
  const helpPausedRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);
  const boardShellRef = useRef<HTMLDivElement | null>(null);
  const boardAreaRef = useRef<HTMLElement | null>(null);
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const longPressRef = useRef<number | null>(null);
  const suppressClickRef = useRef<number | null>(null);
  const lastPointerTypeRef = useRef("mouse");
  const scanTimerRef = useRef<number | null>(null);
  const hintTimerRef = useRef<number | null>(null);
  const endTimerRef = useRef<number | null>(null);
  const burstTimersRef = useRef<number[]>([]);

  const commit = useCallback((next: GameState) => {
    gameRef.current = next;
    setGame(next);
  }, []);

  const playSound = useCallback(
    (kind: Sound) => {
      if (!soundOn) return;
      try {
        const context = audioRef.current ?? new AudioContext();
        audioRef.current = context;
        if (context.state === "suspended") void context.resume();

        const notes: Record<Sound, [number, number, number, number][]> = {
          start: [[420, 0, 0.12, 0.025], [620, 0.08, 0.15, 0.025]],
          find: [[440, 0, 0.16, 0.042], [660, 0.075, 0.18, 0.039], [880, 0.15, 0.25, 0.032]],
          miss: [[220, 0, 0.095, 0.024]],
          mark: [[510, 0, 0.085, 0.02]],
          hint: [[520, 0, 0.19, 0.025], [780, 0.12, 0.21, 0.021]],
          pause: [[360, 0, 0.11, 0.02]],
          win: [[520, 0, 0.2, 0.04], [660, 0.11, 0.2, 0.04], [780, 0.22, 0.2, 0.04], [1040, 0.33, 0.4, 0.035]],
          lose: [[260, 0, 0.2, 0.027], [190, 0.14, 0.3, 0.024]],
        };

        notes[kind].forEach(([frequency, delay, duration, volume]) => {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          const start = context.currentTime + delay;
          oscillator.type = kind === "miss" || kind === "lose" ? "triangle" : "sine";
          oscillator.frequency.setValueAtTime(frequency, start);
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.start(start);
          oscillator.stop(start + duration + 0.02);
        });
      } catch {
        // Audio is optional; visual feedback always remains available.
      }
    },
    [soundOn],
  );

  const vibrate = useCallback((duration: number | number[]) => {
    if (typeof navigator.vibrate === "function") navigator.vibrate(duration);
  }, []);

  const spawnBurst = useCallback((index: number, label: string, kind: Burst["kind"]) => {
    const id = Date.now() + Math.random();
    setBursts((previous) => [...previous, { id, index, label, kind }]);
    const timer = window.setTimeout(() => {
      setBursts((previous) => previous.filter((burst) => burst.id !== id));
    }, 1150);
    burstTimersRef.current.push(timer);
  }, []);

  const finishRun = useCallback(
    (outcome: "won" | "lost", current: GameState) => {
      if (current.phase !== "playing") return;
      const seconds =
        outcome === "lost"
          ? 0
          : Math.max(0, Math.ceil(((deadlineRef.current ?? Date.now()) - Date.now()) / 1000));
      const finalScore = Math.max(0, current.score + (outcome === "won" ? 250 + seconds * 5 : 0));
      const finished: GameState = { ...current, phase: outcome, score: finalScore, timeLeft: seconds };
      deadlineRef.current = null;
      commit(finished);

      const previousBest = highScoresRef.current[0]?.score ?? 0;
      const entry: HighScore = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: currentPlayerRef.current,
        score: finalScore,
        found: current.found,
        won: outcome === "won",
        date: Date.now(),
      };
      const nextScores = [...highScoresRef.current, entry]
        .sort((a, b) => b.score - a.score || a.date - b.date)
        .slice(0, 5);
      highScoresRef.current = nextScores;
      setHighScores(nextScores);
      writeStored(SCORES_KEY, JSON.stringify(nextScores));
      const rank = nextScores.findIndex((score) => score.id === entry.id);
      setRunRank(rank === -1 ? null : rank + 1);
      setNewRecord(finalScore > previousBest && finalScore > 0);

      if (outcome === "won") {
        setMessage("همه‌ی حیوان‌ها پیدا شدند! چه چشم تیزبینی!");
        spawnBurst(44, "", "win");
        playSound("win");
        vibrate([35, 55, 65]);
        setEndVisible(false);
        if (endTimerRef.current !== null) window.clearTimeout(endTimerRef.current);
        endTimerRef.current = window.setTimeout(() => setEndVisible(true), 720);
      } else {
        setMessage("زمان به پایان رسید. همین حالا دوباره تلاش کن.");
        playSound("lose");
        vibrate(65);
        setEndVisible(true);
      }
    },
    [commit, playSound, spawnBurst, vibrate],
  );

  const revealCell = useCallback(
    (index: number) => {
      const current = gameRef.current;
      if (current.phase !== "playing") return;
      const board = current.started ? current.board : createBoard(index, current.board);
      const cell = board[index];
      if (cell.revealed || cell.marked) return;

      if (!current.started) deadlineRef.current = Date.now() + ROUND_SECONDS * 1000;

      if (cell.animalId !== null) {
        deadlineRef.current = (deadlineRef.current ?? Date.now()) + FIND_TIME_BONUS * 1000;
        const streak = current.streak + 1;
        const points = 180 + Math.min(streak - 1, 4) * 35;
        const found = current.found + 1;
        const next: GameState = {
          ...current,
          board: revealAnimal(board, index),
          started: true,
          found,
          streak,
          score: current.score + points,
          timeLeft: Math.ceil(((deadlineRef.current ?? Date.now()) - Date.now()) / 1000),
          lastFoundIndex: index,
        };
        commit(next);
        setMessage(`${ANIMALS[cell.animalId].name} پیدا شد! سطر، ستون و همسایه‌هایش حالا امن‌اند.`);
        setScanIndex(index);
        if (scanTimerRef.current !== null) window.clearTimeout(scanTimerRef.current);
        scanTimerRef.current = window.setTimeout(() => setScanIndex(null), 850);
        spawnBurst(index, `+${fa(points)}`, "find");
        animateBoard(
          boardShellRef.current,
          [
            { transform: "scale(1)" },
            { transform: "scale(1.012)" },
            { transform: "scale(1)" },
          ],
          { duration: 340, easing: "cubic-bezier(.2,.8,.2,1)" },
        );
        playSound("find");
        vibrate(22);
        if (found === ANIMALS.length) finishRun("won", next);
      } else {
        const penalty = cell.adjacent > 0 ? 8 : 12;
        const nextBoard = [...board];
        nextBoard[index] = { ...cell, revealed: true, marked: false, revealDelay: 0, source: "tap" };
        commit({
          ...current,
          board: nextBoard,
          started: true,
          score: Math.max(0, current.score - penalty),
          streak: 0,
          probes: current.probes + 1,
          timeLeft: Math.ceil(((deadlineRef.current ?? Date.now()) - Date.now()) / 1000),
        });
        setMessage(
          cell.adjacent > 0
            ? `${fa(cell.adjacent)} حیوان در خانه‌های اطراف این سرنخ است.`
            : "اینجا خبری نیست. کمی دورتر را امتحان کن.",
        );
        spawnBurst(index, `-${fa(penalty)}`, "miss");
        animateBoard(
          boardShellRef.current,
          [
            { transform: "translateX(0)" },
            { transform: "translateX(-4px)" },
            { transform: "translateX(4px)" },
            { transform: "translateX(-2px)" },
            { transform: "translateX(0)" },
          ],
          { duration: 235, easing: "ease-out" },
        );
        playSound("miss");
        vibrate(8);
      }
    },
    [commit, finishRun, playSound, spawnBurst, vibrate],
  );

  const toggleMark = useCallback(
    (index: number) => {
      const current = gameRef.current;
      if (current.phase !== "playing" || current.board[index].revealed) return;
      const board = [...current.board];
      const marked = !board[index].marked;
      board[index] = { ...board[index], marked };
      commit({ ...current, board });
      setMessage(marked ? "اینجا را نشان کردی. دوباره بزن تا نشان برداشته شود." : "نشان این خانه برداشته شد.");
      playSound("mark");
      vibrate(12);
    },
    [commit, playSound, vibrate],
  );

  const useHint = useCallback(() => {
    const current = gameRef.current;
    if (current.phase !== "playing" || !current.started || current.hintsUsed >= 2) return;
    const hiddenAnimals = current.board
      .map((cell, index) => (cell.animalId !== null && !cell.revealed ? index : -1))
      .filter((index) => index !== -1);
    if (hiddenAnimals.length === 0) return;
    const index = hiddenAnimals[Math.floor(Math.random() * hiddenAnimals.length)];
    setHintIndex(index);
    if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current);
    hintTimerRef.current = window.setTimeout(() => setHintIndex(null), 2800);
    commit({
      ...current,
      hintsUsed: current.hintsUsed + 1,
      score: Math.max(0, current.score - 75),
    });
    setMessage("یک حیوان در محدوده‌ی خانه‌های درخشان پنهان شده است.");
    playSound("hint");
    vibrate(14);
  }, [commit, playSound, vibrate]);

  const startGame = useCallback((focusIndex = 44, playStartTone = true) => {
    if (scanTimerRef.current !== null) window.clearTimeout(scanTimerRef.current);
    if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current);
    if (endTimerRef.current !== null) window.clearTimeout(endTimerRef.current);
    if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
    deadlineRef.current = null;
    pausedRemainingRef.current = ROUND_SECONDS * 1000;
    currentPlayerRef.current = playerName.trim().slice(0, 18) || "کاوشگر";
    writeStored(NAME_KEY, playerName.trim().slice(0, 18));
    commit(newGame("playing"));
    setMessage("یکی از خانه‌ها را باز کن؛ اولین کشف حتما با توست!");
    setSelectedCell(focusIndex);
    setFlagMode(false);
    setHintIndex(null);
    setScanIndex(null);
    setBursts([]);
    setHelpOpen(false);
    setEndVisible(false);
    setRunRank(null);
    setNewRecord(false);
    if (playStartTone) playSound("start");

    window.setTimeout(() => {
      if (window.matchMedia("(max-width: 960px)").matches) {
        boardAreaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        tileRefs.current[focusIndex]?.focus({ preventScroll: true });
      }
    }, 80);
  }, [commit, playSound, playerName]);

  const pauseGame = useCallback(() => {
    const current = gameRef.current;
    if (current.phase !== "playing") return;
    pausedRemainingRef.current = current.started
      ? Math.max(0, (deadlineRef.current ?? Date.now()) - Date.now())
      : ROUND_SECONDS * 1000;
    deadlineRef.current = null;
    commit({
      ...current,
      phase: "paused",
      timeLeft: Math.ceil(pausedRemainingRef.current / 1000),
    });
    playSound("pause");
  }, [commit, playSound]);

  const resumeGame = useCallback(() => {
    const current = gameRef.current;
    if (current.phase !== "paused") return;
    if (current.started) deadlineRef.current = Date.now() + pausedRemainingRef.current;
    commit({ ...current, phase: "playing" });
    window.setTimeout(() => tileRefs.current[selectedCell]?.focus({ preventScroll: true }), 50);
  }, [commit, selectedCell]);

  const openHelp = useCallback(() => {
    helpPausedRef.current = gameRef.current.phase === "playing";
    if (helpPausedRef.current) pauseGame();
    setHelpOpen(true);
  }, [pauseGame]);

  const closeHelp = useCallback(() => {
    setHelpOpen(false);
    if (helpPausedRef.current) {
      helpPausedRef.current = false;
      resumeGame();
    }
  }, [resumeGame]);

  useEffect(() => {
    if (game.phase !== "playing" || !game.started) return;
    const timer = window.setInterval(() => {
      const current = gameRef.current;
      if (current.phase !== "playing") return;
      const remaining = Math.max(0, Math.ceil(((deadlineRef.current ?? Date.now()) - Date.now()) / 1000));
      if (remaining === 0) {
        finishRun("lost", current);
      } else if (remaining !== current.timeLeft) {
        commit({ ...current, timeLeft: remaining });
      }
    }, 180);
    return () => window.clearInterval(timer);
  }, [game.phase, game.started, commit, finishRun]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();

      if (event.key === "Escape") {
        if (helpOpen) closeHelp();
        else if (gameRef.current.phase === "playing") pauseGame();
        else if (gameRef.current.phase === "paused") resumeGame();
        return;
      }
      if (helpOpen) return;
      if (key === "p") {
        event.preventDefault();
        if (gameRef.current.phase === "playing") pauseGame();
        else if (gameRef.current.phase === "paused") resumeGame();
      } else if (key === "r" && gameRef.current.phase !== "start") {
        event.preventDefault();
        startGame();
      } else if (key === "h" && gameRef.current.phase === "playing") {
        event.preventDefault();
        useHint();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeHelp, helpOpen, pauseGame, resumeGame, startGame, useHint]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden && gameRef.current.phase === "playing") pauseGame();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [pauseGame]);

  useEffect(() => {
    if (!helpOpen && game.phase !== "paused" && !((game.phase === "won" || game.phase === "lost") && endVisible)) return;
    const timer = window.setTimeout(() => {
      const selector = helpOpen ? ".help-modal .modal-close" : ".modal-backdrop .modal-action";
      document.querySelector<HTMLButtonElement>(selector)?.focus();
    }, 40);
    return () => window.clearTimeout(timer);
  }, [helpOpen, game.phase, endVisible]);

  useEffect(
    () => () => {
      if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
      if (scanTimerRef.current !== null) window.clearTimeout(scanTimerRef.current);
      if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current);
      if (endTimerRef.current !== null) window.clearTimeout(endTimerRef.current);
      burstTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  const handleGridKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (game.phase !== "playing") return;
    const focusedIndex = Number((event.target as HTMLElement).dataset.index);
    const index = Number.isNaN(focusedIndex) ? selectedCell : focusedIndex;
    let next = index;
    if (event.key === "ArrowRight") next = Math.min(GRID_SIZE - 1, (index % GRID_SIZE) + 1) + Math.floor(index / GRID_SIZE) * GRID_SIZE;
    else if (event.key === "ArrowLeft") next = Math.max(0, (index % GRID_SIZE) - 1) + Math.floor(index / GRID_SIZE) * GRID_SIZE;
    else if (event.key === "ArrowDown") next = Math.min(GRID_SIZE - 1, Math.floor(index / GRID_SIZE) + 1) * GRID_SIZE + (index % GRID_SIZE);
    else if (event.key === "ArrowUp") next = Math.max(0, Math.floor(index / GRID_SIZE) - 1) * GRID_SIZE + (index % GRID_SIZE);
    else if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      toggleMark(index);
      return;
    } else return;

    event.preventDefault();
    setSelectedCell(next);
    tileRefs.current[next]?.focus({ preventScroll: true });
  };

  const clearLongPress = () => {
    if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
    longPressRef.current = null;
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, index: number) => {
    setSelectedCell(index);
    lastPointerTypeRef.current = event.pointerType;
    suppressClickRef.current = null;
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    clearLongPress();
    longPressRef.current = window.setTimeout(() => {
      suppressClickRef.current = index;
      toggleMark(index);
      longPressRef.current = null;
    }, 460);
  };

  const handleTileClick = (index: number) => {
    setSelectedCell(index);
    if (suppressClickRef.current === index) {
      suppressClickRef.current = null;
      return;
    }
    suppressClickRef.current = null;
    if (flagMode) toggleMark(index);
    else revealCell(index);
  };

  const startFromPreview = (index: number) => {
    startGame(index, false);
    revealCell(index);
  };

  const trapModalFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    writeStored(SOUND_KEY, next ? "on" : "off");
  };

  const isPreview = game.phase === "start";
  const board = isPreview ? PREVIEW_BOARD : game.board;
  const best = highScores[0]?.score ?? 0;
  const lastAnimalId =
    game.lastFoundIndex !== null ? game.board[game.lastFoundIndex].animalId : null;

  return (
    <div className="app" dir="rtl">
      <header className="site-header">
        <div className="header-inner page-width">
          <div className="header-brand" aria-label="ردپا">
            <span className="brand-symbol"><PawPrint size={23} strokeWidth={2.3} aria-hidden="true" /></span>
            <span className="brand-words"><strong>ردپا</strong><small>WILDLIFE SWEEP</small></span>
          </div>
          <div className="header-middle"><span />یک جنگل، صد خانه، هشت راز<span /></div>
          <div className="header-actions">
            <button type="button" className="icon-button" onClick={toggleSound} aria-label={soundOn ? "قطع صدا" : "روشن کردن صدا"} title={soundOn ? "قطع صدا" : "روشن کردن صدا"}>
              {soundOn ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </button>
            <button type="button" className="icon-button" onClick={openHelp} aria-label="راهنمای بازی" title="راهنمای بازی">
              <CircleHelp size={21} />
            </button>
          </div>
        </div>
      </header>

      <main className={`game-layout page-width ${isPreview ? "layout--start" : "layout--active"}`}>
        <div className="story-column">
          <section className="story-panel">
            {isPreview ? (
              <>
                <div className="eyebrow"><span className="eyebrow-line" />یک بازی برای چشم‌های تیزبین</div>
                <h1 className="wordmark">ردپا<span>.</span></h1>
                <span className="wordmark-caption">A LITTLE WILD, A LITTLE WISE</span>
                <h2 className="intro-headline">ببین کی توی جنگل<br />قایم شده.</h2>
                <p className="intro-copy">هشت چهره‌ی حیوانی در یک نقشه‌ی ده در ده پنهان شده‌اند. خانه‌ها را باز کن، سرنخ‌ها را بخوان و همه را پیدا کن.</p>
                <div className="name-field">
                  <label htmlFor="player-name">نام کاوشگر <span>برای ثبت رکورد</span></label>
                  <input
                    id="player-name"
                    value={playerName}
                    onChange={(event) => setPlayerName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") startGame();
                    }}
                    maxLength={18}
                    placeholder="مثلا سارا"
                    autoComplete="nickname"
                  />
                </div>
                <button type="button" className="primary-button start-button" onClick={() => startGame()}>
                  <span>شروع بازی</span><span className="button-icon"><ArrowLeft size={22} strokeWidth={2.3} /></span>
                </button>
                <p className="first-move-note"><span className="note-spark" />اولین خانه‌ای که باز کنی، یک کشف قطعی است.</p>
                <div className="golden-rule">
                  <span>قانون طلایی</span>
                  <p>هیچ دو حیوانی در یک سطر، یک ستون یا خانه‌های چسبیده به هم نیستند. هر کشف، اطرافش را روشن می‌کند.</p>
                </div>
              </>
            ) : (
              <>
                <div className="eyebrow"><span className="eyebrow-line" />در حال کاوش در جنگل</div>
                <h1 className="wordmark wordmark--playing">ردپا<span>.</span></h1>
                <p className="playing-intro">هر خانه یک سرنخ است.<br />رد بقیه را دنبال کن.</p>
                <div className="score-display">
                  <span>امتیاز تو</span>
                  <strong key={game.score}>{fa(game.score)}</strong>
                  <small>بهترین رکورد <b>{fa(best)}</b></small>
                </div>
                <div className="progress-heading"><span>چهره‌های پیدا شده</span><strong>{fa(game.found)} <em>/ {fa(ANIMALS.length)}</em></strong></div>
                <div className="progress-segments" role="progressbar" aria-label="پیشرفت پیدا کردن حیوان‌ها" aria-valuenow={game.found} aria-valuemin={0} aria-valuemax={ANIMALS.length}>
                  {ANIMALS.map((animal, index) => <span key={animal.english} className={index < game.found ? "filled" : ""} />)}
                </div>
                <p className="playing-rule">با پیدا کردن هر حیوان، تمام سطر و ستونش و هشت خانه‌ی دورش امن می‌شوند. عددها تعداد حیوان‌های اطراف هر خانه‌اند.</p>
                <button type="button" className="text-restart" onClick={() => startGame()}><RotateCcw size={16} />شروع دوباره <span>R</span></button>
              </>
            )}
          </section>
          <Leaderboard scores={highScores} />
        </div>

        <section className="board-area" ref={boardAreaRef} aria-label="زمین بازی">
          <div className="board-topline">
            <div className="board-heading"><span className="overline">THE FIELD / 01</span><h2>نقشه‌ی جنگل <small>۱۰ × ۱۰</small></h2></div>
            {isPreview ? (
              <span className="preview-label"><span />لمس کن و شروع کن</span>
            ) : (
              <div className="board-hud">
                <div><span>زمان</span><strong className={game.timeLeft <= 20 ? "time-warning" : ""}>{clock(game.timeLeft)}</strong></div>
                <div><span>پیدا شده</span><strong>{fa(game.found)} <small>/ {fa(ANIMALS.length)}</small></strong></div>
              </div>
            )}
          </div>

          <div className={`board-shell ${game.phase === "won" ? "board-shell--won" : ""}`} ref={boardShellRef}>
            <div className="board-shell-header"><span><i className="instrument-dot" />RADPA / FIELD MAP</span><span>NO. 001</span></div>
            <div className={`board-grid ${isPreview ? "board-grid--preview" : ""}`} dir="ltr" role="group" aria-label="نقشه ده در ده، با کلیدهای جهت‌نما حرکت کن" onKeyDown={handleGridKeyDown}>
              {board.map((cell, index) => {
                const row = Math.floor(index / GRID_SIZE);
                const col = index % GRID_SIZE;
                const missedAnimal = game.phase === "lost" && cell.animalId !== null && !cell.revealed;
                const visibleAnimal = cell.animalId !== null && (cell.revealed || missedAnimal);
                const isOpen = cell.revealed && cell.animalId === null;
                const hinted =
                  hintIndex !== null &&
                  !cell.revealed &&
                  Math.abs(row - Math.floor(hintIndex / GRID_SIZE)) <= 1 &&
                  Math.abs(col - (hintIndex % GRID_SIZE)) <= 1;
                const tileClass = [
                  "tile",
                  visibleAnimal ? "tile--animal" : isOpen ? "tile--open" : "tile--hidden",
                  isOpen && cell.adjacent === 0 ? "tile--empty" : "",
                  cell.marked && !cell.revealed && !missedAnimal ? "tile--marked" : "",
                  missedAnimal ? "tile--missed" : "",
                  isPreview && index === 45 ? "tile--preview-focus" : "",
                  hinted ? "tile--hinted" : "",
                ].filter(Boolean).join(" ");
                const content = visibleAnimal ? (
                  <AnimalPortrait id={cell.animalId!} />
                ) : cell.marked && !cell.revealed ? (
                  <Flag className="tile-flag" size={21} fill="currentColor" strokeWidth={1.8} aria-hidden="true" />
                ) : isOpen && cell.adjacent > 0 ? (
                  <span className={`clue clue--${cell.adjacent}`}>{fa(cell.adjacent)}</span>
                ) : null;

                if (isPreview) return <button key={index} type="button" className={tileClass} tabIndex={index === 45 ? 0 : -1} aria-label={`شروع بازی از ردیف ${fa(row + 1)}، ستون ${fa(col + 1)}`} onClick={() => startFromPreview(index)}>{content}</button>;

                const description = visibleAnimal
                  ? missedAnimal ? `حیوان پیدا نشده، ${ANIMALS[cell.animalId!].name}` : `${ANIMALS[cell.animalId!].name} پیدا شده`
                  : cell.marked && !cell.revealed ? "نشان‌گذاری شده"
                  : isOpen ? cell.adjacent > 0 ? `${fa(cell.adjacent)} حیوان در همسایگی` : "خالی و امن"
                  : "پوشیده";
                const style = cell.revealed ? { "--reveal-delay": `${cell.revealDelay}ms` } as CSSProperties : undefined;

                return (
                  <button
                    key={index}
                    ref={(element) => { tileRefs.current[index] = element; }}
                    type="button"
                    className={tileClass}
                    style={style}
                    data-index={index}
                    tabIndex={selectedCell === index && game.phase === "playing" ? 0 : -1}
                    disabled={game.phase !== "playing"}
                    aria-label={`ردیف ${fa(row + 1)}، ستون ${fa(col + 1)}، ${description}`}
                    onFocus={() => setSelectedCell(index)}
                    onClick={() => handleTileClick(index)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      const alreadyMarkedByHold = suppressClickRef.current === index;
                      clearLongPress();
                      if (lastPointerTypeRef.current !== "mouse") suppressClickRef.current = index;
                      if (!alreadyMarkedByHold) toggleMark(index);
                    }}
                    onPointerDown={(event) => handlePointerDown(event, index)}
                    onPointerUp={clearLongPress}
                    onPointerCancel={clearLongPress}
                    onPointerLeave={clearLongPress}
                  >
                    {content}
                  </button>
                );
              })}

              {scanIndex !== null && (game.phase === "playing" || game.phase === "won") && (
                <div className="scan-effect" key={scanIndex} aria-hidden="true">
                  <span className="scan-line scan-line--row" style={{ top: `${(Math.floor(scanIndex / GRID_SIZE) + 0.5) * 10}%`, "--scan-origin": `${((scanIndex % GRID_SIZE) + 0.5) * 10}%` } as CSSProperties} />
                  <span className="scan-line scan-line--column" style={{ left: `${((scanIndex % GRID_SIZE) + 0.5) * 10}%`, "--scan-origin": `${(Math.floor(scanIndex / GRID_SIZE) + 0.5) * 10}%` } as CSSProperties} />
                </div>
              )}
              {bursts.map((burst) => <BurstEffect key={burst.id} burst={burst} />)}
            </div>
            <div className="board-shell-footer"><span>OBSERVE <i /> DISCOVER <i /> REPEAT</span><span>10 / 10</span></div>
            {!isPreview && <div className="time-track" aria-hidden="true"><span className={game.timeLeft <= 20 ? "time-track--warning" : ""} style={{ width: `${Math.min(100, (game.timeLeft / ROUND_SECONDS) * 100)}%` }} /></div>}
          </div>

          {isPreview ? (
            <div className="board-after"><span className="board-caption"><span className="caption-line" />این یک نمونه است. هر خانه را بزنی، بازی همان‌جا شروع می‌شود.</span></div>
          ) : (
            <>
              <div className="board-tools">
                <button type="button" className={`tool-button ${flagMode ? "tool-button--active" : ""}`} onClick={() => setFlagMode((value) => !value)} disabled={game.phase !== "playing"} aria-pressed={flagMode} title="برای نشان‌گذاری روی موبایل، این حالت را روشن کن">
                  <Flag size={18} strokeWidth={1.9} /><span>نشان‌گذاری</span><small>F</small>
                </button>
                <button type="button" className="tool-button" onClick={useHint} disabled={game.phase !== "playing" || !game.started || game.hintsUsed >= 2} title="یک ناحیه سه در سه را نشان می‌دهد؛ ۷۵ امتیاز هزینه دارد">
                  <Lightbulb size={19} strokeWidth={1.9} /><span>سرنخ</span><small>{fa(2 - game.hintsUsed)}</small>
                </button>
                <button type="button" className="tool-button tool-button--pause" onClick={pauseGame} disabled={game.phase !== "playing"}>
                  <Pause size={18} strokeWidth={1.9} /><span>مکث</span><small>P</small>
                </button>
              </div>
              <p className="board-message" role="status" aria-live="polite"><span className="message-dot" />{message}</p>
            </>
          )}
        </section>
      </main>

      <footer className="site-footer page-width"><span>RADPA © 2026</span><span>یک بازی کوچک، یک جنگل بزرگ.</span></footer>

      {helpOpen && (
        <div className="modal-backdrop" onKeyDown={trapModalFocus} onMouseDown={(event) => { if (event.target === event.currentTarget) closeHelp(); }}>
          <div className="modal-card help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title">
            <button type="button" className="modal-close" onClick={closeHelp} aria-label="بستن راهنما"><X size={20} /></button>
            <span className="modal-overline">FIELD GUIDE / راهنمای بازی</span>
            <h2 id="help-title">قانون جنگل ساده‌ست.</h2>
            <p className="modal-intro">هشت حیوان را در نقشه‌ی ده در ده پیدا کن. اولین انتخابت همیشه یک حیوان است؛ بعد از آن سرنخ‌ها راه را نشانت می‌دهند.</p>
            <div className="help-steps">
              <div><span>۰۱</span><p><strong>فاصله را حفظ کن</strong>هیچ دو حیوانی هم‌سطر، هم‌ستون یا حتی از گوشه کنار هم نیستند.</p></div>
              <div><span>۰۲</span><p><strong>عددها را بخوان</strong>عدد هر خانه، تعداد حیوان‌ها در هشت خانه‌ی اطرافش را نشان می‌دهد.</p></div>
              <div><span>۰۳</span><p><strong>از هر کشف استفاده کن</strong>سطر، ستون و همسایه‌های حیوان پیدا شده خودکار باز می‌شوند. هر کشف هم پنج ثانیه زمان می‌دهد.</p></div>
            </div>
            <div className="help-controls"><span>لمس: باز کردن</span><span>لمس طولانی یا کلیک راست: نشان</span><span>جهت‌نما + Enter: حرکت و باز کردن</span><span>F: نشان / H: سرنخ / P: مکث / R: شروع دوباره</span><span>خانه‌ی خالی امتیاز کم می‌کند؛ سرنخ ۷۵ امتیاز.</span></div>
            <button type="button" className="primary-button modal-action" onClick={closeHelp}>فهمیدم، بریم <ArrowLeft size={19} /></button>
          </div>
        </div>
      )}

      {game.phase === "paused" && !helpOpen && (
        <div className="modal-backdrop" onKeyDown={trapModalFocus}>
          <div className="modal-card pause-modal" role="dialog" aria-modal="true" aria-labelledby="pause-title">
            <span className="pause-symbol"><Pause size={35} fill="currentColor" strokeWidth={1.4} /></span>
            <span className="modal-overline">A LITTLE BREAK</span>
            <h2 id="pause-title">جنگل صبر می‌کند.</h2>
            <p className="modal-intro">بازی مکث شده و زمانت نگه داشته شده است. هر وقت آماده بودی برگرد.</p>
            <button type="button" className="primary-button modal-action" onClick={resumeGame}>ادامه بازی <Play size={19} fill="currentColor" /></button>
            <button type="button" className="modal-text-button" onClick={() => startGame()}><RotateCcw size={16} />یک بازی تازه</button>
            <span className="modal-shortcut">برای ادامه، کلید P یا Esc را بزن.</span>
          </div>
        </div>
      )}

      {(game.phase === "won" || game.phase === "lost") && endVisible && !helpOpen && (
        <div className="modal-backdrop" onKeyDown={trapModalFocus}>
          <div className="modal-card result-modal" role="dialog" aria-modal="true" aria-labelledby="result-title">
            <div className="result-portrait">
              {lastAnimalId !== null && <AnimalPortrait id={lastAnimalId} />}
              <span><PawPrint size={17} fill="currentColor" /></span>
            </div>
            <span className="modal-overline">{game.phase === "won" ? "MISSION COMPLETE" : "TIME IS UP"}</span>
            <h2 id="result-title">{game.phase === "won" ? "همه پیدا شدند!" : "وقت تموم شد."}</h2>
            <p className="modal-intro">{game.phase === "won" ? "تمام چهره‌های پنهان جنگل را کشف کردی. این یکی برای تو بود!" : `${fa(game.found)} حیوان از ${fa(ANIMALS.length)} حیوان را پیدا کردی. جنگل برای یک دور دیگر منتظر توست.`}</p>
            <div className="result-score"><span>امتیاز نهایی</span><strong>{fa(game.score)}</strong></div>
            {newRecord && <div className="record-message"><Trophy size={18} />رکورد تازه روی این دستگاه!</div>}
            <div className="result-details"><span>کشف‌ها <b>{fa(game.found)} / {fa(ANIMALS.length)}</b></span><span>رتبه <b>{runRank === null ? "بیرون از ۵ نفر" : fa(runRank)}</b></span></div>
            <button type="button" className="primary-button modal-action" onClick={() => startGame()}>یک دور دیگر <RotateCcw size={19} /></button>
            <div className="result-leaders"><span>بهترین رکوردهای این دستگاه</span>{highScores.slice(0, 3).map((entry, index) => <div key={entry.id}><small>{fa(index + 1)}. {entry.name}</small><strong>{fa(entry.score)}</strong></div>)}</div>
            <span className="modal-shortcut">یا فقط کلید R را بزن.</span>
          </div>
        </div>
      )}
    </div>
  );
}