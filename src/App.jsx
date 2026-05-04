import { useEffect, useRef, useState } from "react";

import muniverseBg from "./assets/muniversebg.PNG";
import blobImage from "./assets/blub.PNG";
import token1Image from "./assets/token1.PNG";
import token2Image from "./assets/token2.PNG";
import token3Image from "./assets/token3.PNG";
import token4Image from "./assets/token4.PNG";
import token5Image from "./assets/token5.PNG";
import token6Image from "./assets/token6.PNG";
import token7Image from "./assets/token7.PNG";
import token8Image from "./assets/token8.PNG";
import token9Image from "./assets/token9.PNG";

const TOKEN_SIZE = 74;
const FLOAT_AMPLITUDE = 8;
const SNAP_DURATION_MS = 420;
const ABSORB_DURATION_MS = 520;
const RETURN_DURATION_MS = 320;
const CLICK_BOUNCE_DURATION_MS = 240;
const DRAG_THRESHOLD = 8;
const BASE_SIZE = 340;
const BLOB_SAFE_RADIUS = BASE_SIZE / 2 + TOKEN_SIZE / 2 + 34;
const MIN_ORBIT_RADIUS = 228;
const MAX_ORBIT_RADIUS = 340;

const TOKEN_DEFS = [
  { id: 1, type: "volumeUp", label: "Volume up", image: token1Image },
  { id: 2, type: "volumeDown", label: "Volume down", image: token2Image },
  { id: 3, type: "speedUp", label: "Speed up", image: token3Image },
  { id: 4, type: "slowDown", label: "Slow down", image: token4Image },
  { id: 5, type: "echo", label: "Echo", image: token5Image },
  { id: 6, type: "lowPass", label: "Low pass", image: token6Image },
  { id: 7, type: "highPass", label: "High pass", image: token7Image },
  { id: 8, type: "nextTrack", label: "Next track", image: token8Image },
  { id: 9, type: "undo", label: "Undo", image: token9Image }
];

const seeded = (seed) => {
  const value = Math.sin(seed * 999) * 10000;
  return value - Math.floor(value);
};

function App() {
  const audioRef = useRef(null);
  const blobRef = useRef(null);
  const fileInputRef = useRef(null);
  const audioContextRef = useRef(null);
  const sourceRef = useRef(null);
  const analyserRef = useRef(null);
  const effectNodesRef = useRef([]);
  const playlistUrlsRef = useRef([]);
  const effectStackRef = useRef([]);
  const dataArrayRef = useRef(null);
  const animationFrameRef = useRef(null);
  const currentSizeRef = useRef(BASE_SIZE);
  const targetSizeRef = useRef(BASE_SIZE);
  const smoothedAmplitudeRef = useRef(0);
  const smoothedBassEnergyRef = useRef(0);
  const beatPulseRef = useRef(0);
  const beatHistoryRef = useRef([]);
  const energyFloorRef = useRef(0);
  const lastBeatTimeRef = useRef(0);
  const idlePhaseRef = useRef(0);
  const lastFrameTimeRef = useRef(0);
  const tokensRef = useRef([]);
  const draggedTokenIdRef = useRef(null);
  const dragPointerOffsetRef = useRef({ x: 0, y: 0 });
  const pointerStartRef = useRef({ x: 0, y: 0, moved: false });
  const modeRef = useRef("idle");
  const blobPulseRef = useRef(0);
  const mouseParallaxRef = useRef({ x: 0, y: 0 });
  const smoothedParallaxRef = useRef({ x: 0, y: 0 });

  const [playlist, setPlaylist] = useState([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [effectStack, setEffectStack] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [size, setSize] = useState(BASE_SIZE);
  const [tokens, setTokens] = useState([]);
  const [draggedTokenId, setDraggedTokenId] = useState(null);
  const [mode, setMode] = useState("idle");
  const [blobPulse, setBlobPulse] = useState(0);
  const [parallaxOffset, setParallaxOffset] = useState({ x: 0, y: 0 });

  const IDLE_AMPLITUDE = 16;
  const IDLE_SPEED = 0.0014;
  const SIZE_LERP = 0.1;
  const AUDIO_SMOOTHING = 0.14;
  const BASS_SMOOTHING = 0.18;
  const BEAT_HISTORY_SIZE = 60;
  const BEAT_THRESHOLD_MULTIPLIER = 1.08;
  const MIN_BEAT_INTERVAL_MS = 220;
  const BEAT_PULSE_DECAY = 0.94;
  const BASS_BIN_COUNT = 12;
  const ENERGY_FLOOR_RISE = 0.02;
  const ENERGY_FLOOR_FALL = 0.008;
  const MIN_BEAT_DELTA = 0.018;

  const currentTrackUrl = playlist[currentTrackIndex] ?? "";
  
  const lerp = (start, end, amount) => start + (end - start) * amount;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const createTokenState = (width = window.innerWidth, height = window.innerHeight) => {
    const centerX = width / 2;
    const centerY = height / 2;
    const orbitRadius = clamp(
      Math.max(BLOB_SAFE_RADIUS + 24, Math.min(width, height) * 0.32),
      MIN_ORBIT_RADIUS,
      MAX_ORBIT_RADIUS
    );

    return TOKEN_DEFS.map((token, index) => {
      const angle = -Math.PI / 2 + (index / TOKEN_DEFS.length) * Math.PI * 2;
      const originalX = clamp(
        centerX + Math.cos(angle) * orbitRadius - TOKEN_SIZE / 2,
        20,
        width - TOKEN_SIZE - 20
      );
      const originalY = clamp(
        centerY + Math.sin(angle) * orbitRadius - TOKEN_SIZE / 2,
        20,
        height - TOKEN_SIZE - 20
      );
      
      // Assign depth: cycle from 1-9 for layered effect
      const depth = ((index % 3) + 1) + ((Math.floor(index / 3) % 3) * 3);
     
      return {
        ...token,
        x: originalX,
        y: originalY,
        originalX,
        originalY,
        phase: seeded(index + 41) * Math.PI * 2,
        floatSpeed: 0.001 + seeded(index + 71) * 0.00035,
        floatAmplitude: FLOAT_AMPLITUDE + seeded(index + 101) * 3,
        animationState: "idle",
        opacity: 1,
        scale: 1,
        depth: depth,
        snapStartX: originalX,
        snapStartY: originalY,
        snapTargetX: originalX,
        snapTargetY: originalY,
        snapStartTime: 0
      };
    });
  };

  const averageBins = (binCount) => {
    if (!dataArrayRef.current) return 0;

    let sum = 0;
    const cappedCount = Math.min(binCount, dataArrayRef.current.length);

    for (let i = 0; i < cappedCount; i += 1) {
      sum += dataArrayRef.current[i];
    }

    return cappedCount ? sum / cappedCount / 255 : 0;
  };

  const getDepthEffects = (depth) => {
    // Depth ranges from 1 (far) to 9 (close)
    // Normalize to 0-1 where 0 is far and 1 is close
    const normalizedDepth = (depth - 1) / 8;
    
    // Blur: far tokens (depth 1-3) get blur, close tokens (7-9) are sharp
    const blur = Math.max(0, (1 - normalizedDepth) * 3.5);
    
    // Scale: far tokens are smaller, close tokens are larger
    const scaleMultiplier = 0.7 + normalizedDepth * 0.3;
    
    // Opacity: far tokens are dimmer, close tokens are brighter
    const opacityMultiplier = 0.6 + normalizedDepth * 0.4;
    
    // Parallax intensity: far objects move less, close objects move more
    const parallaxIntensity = (normalizedDepth - 0.5) * 2; // -1 to 1
    
    return {
      blur,
      scaleMultiplier,
      opacityMultiplier,
      parallaxIntensity
    };
  };

  const triggerBlobPulse = (amount = 1) => {
    blobPulseRef.current = Math.max(blobPulseRef.current, amount);
  };

  const ensureAudioContext = async () => {
    if (!audioRef.current) return null;

    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (!sourceRef.current) {
      sourceRef.current = audioContextRef.current.createMediaElementSource(audioRef.current);
    }

    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }

    return audioContextRef.current;
  };

  const rebuildAudioGraph = async (stack = effectStackRef.current) => {
    const audioContext = await ensureAudioContext();
    if (!audioContext || !sourceRef.current || !audioRef.current) return;

    effectNodesRef.current.forEach(({ disconnectors = [] }) => {
      disconnectors.forEach((node) => {
        try {
          node.disconnect();
        } catch {}
      });
    });
    effectNodesRef.current = [];

    try {
      sourceRef.current.disconnect();
    } catch {}
    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch {}
    }

    let currentNode = sourceRef.current;

    const volumeDelta =
      stack.filter((effect) => effect.type === "volumeUp").length -
      stack.filter((effect) => effect.type === "volumeDown").length;
    const speedDelta =
      stack.filter((effect) => effect.type === "speedUp").length -
      stack.filter((effect) => effect.type === "slowDown").length;

    audioRef.current.playbackRate = clamp(1 + speedDelta * 0.12, 0.6, 2);

    const masterGain = audioContext.createGain();
    masterGain.gain.value = clamp(1 + volumeDelta * 0.12, 0, 2);
    currentNode.connect(masterGain);
    effectNodesRef.current.push({ disconnectors: [masterGain] });
    currentNode = masterGain;

    stack.forEach((effect) => {
      if (effect.type === "echo") {
        const inputGain = audioContext.createGain();
        const delayNode = audioContext.createDelay(0.8);
        const feedbackGain = audioContext.createGain();
        const wetGain = audioContext.createGain();

        delayNode.delayTime.value = 0.22;
        feedbackGain.gain.value = 0.34;
        wetGain.gain.value = 0.35;

        currentNode.connect(inputGain);
        inputGain.connect(delayNode);
        delayNode.connect(feedbackGain);
        feedbackGain.connect(delayNode);
        delayNode.connect(wetGain);

        const mergeGain = audioContext.createGain();
        currentNode.connect(mergeGain);
        wetGain.connect(mergeGain);

        effectNodesRef.current.push({
          disconnectors: [inputGain, delayNode, feedbackGain, wetGain, mergeGain]
        });
        currentNode = mergeGain;
      }

      if (effect.type === "lowPass" || effect.type === "highPass") {
        const filter = audioContext.createBiquadFilter();
        filter.type = effect.type === "lowPass" ? "lowpass" : "highpass";
        filter.frequency.value = effect.type === "lowPass" ? 900 : 1800;
        filter.Q.value = 0.7;
        currentNode.connect(filter);
        effectNodesRef.current.push({ disconnectors: [filter] });
        currentNode = filter;
      }
    });

    analyserRef.current = audioContext.createAnalyser();
    analyserRef.current.fftSize = 256;
    currentNode.connect(analyserRef.current);
    analyserRef.current.connect(audioContext.destination);
    dataArrayRef.current = new Uint8Array(analyserRef.current.frequencyBinCount);
  };

  const pushEffect = async (type) => {
    const nextStack = [...effectStackRef.current, { id: `${type}-${Date.now()}`, type }];
    effectStackRef.current = nextStack;
    setEffectStack(nextStack);
    await rebuildAudioGraph(nextStack);
  };

  const undoLastEffect = async () => {
    if (effectStackRef.current.length === 0) return;

    const nextStack = effectStackRef.current.slice(0, -1);
    effectStackRef.current = nextStack;
    setEffectStack(nextStack);
    await rebuildAudioGraph(nextStack);
  };

  const playTrackAtIndex = async (nextIndex) => {
    if (!audioRef.current || playlistUrlsRef.current.length === 0) return;

    const safeIndex =
      ((nextIndex % playlistUrlsRef.current.length) + playlistUrlsRef.current.length) %
      playlistUrlsRef.current.length;

    setCurrentTrackIndex(safeIndex);

    if (audioRef.current) {
      audioRef.current.src = playlistUrlsRef.current[safeIndex];
      audioRef.current.load();
    }

    await rebuildAudioGraph(effectStackRef.current);

    await audioRef.current.play();
    setIsPlaying(true);
    setMode("music");
    modeRef.current = "music";
  };

  const activateTokenType = async (type) => {
    if (!audioRef.current) return;

    if (type === "undo") {
      await undoLastEffect();
      triggerBlobPulse(0.75);
      return;
    }

    if (type === "nextTrack") {
      if (playlistUrlsRef.current.length > 0) {
        await playTrackAtIndex(currentTrackIndex + 1);
        triggerBlobPulse(0.95);
      }
      return;
    }

    await pushEffect(type);
    triggerBlobPulse(
      type === "echo" ? 1.25 : type === "lowPass" || type === "highPass" ? 1.05 : 0.9
    );
  };

  const computeSmoothedAudioSize = (timestamp) => {
    if (!analyserRef.current || !dataArrayRef.current) {
      return targetSizeRef.current;
    }

    analyserRef.current.getByteFrequencyData(dataArrayRef.current);
    const averageAmplitude = averageBins(dataArrayRef.current.length);
    const bassEnergy = averageBins(BASS_BIN_COUNT);

    smoothedAmplitudeRef.current = lerp(
      smoothedAmplitudeRef.current,
      averageAmplitude,
      AUDIO_SMOOTHING
    );

    const previousBassEnergy = smoothedBassEnergyRef.current;
    smoothedBassEnergyRef.current = lerp(
      smoothedBassEnergyRef.current,
      bassEnergy,
      BASS_SMOOTHING
    );

    const bassHistory = beatHistoryRef.current;
    const historyAverage =
      bassHistory.length > 0
        ? bassHistory.reduce((total, value) => total + value, 0) / bassHistory.length
        : smoothedBassEnergyRef.current;

    const historyVariance =
      bassHistory.length > 0
        ? bassHistory.reduce((total, value) => {
            const diff = value - historyAverage;
            return total + diff * diff;
          }, 0) / bassHistory.length
        : 0;
    const historyStdDev = Math.sqrt(historyVariance);

    const bassRise = smoothedBassEnergyRef.current - previousBassEnergy;
    const enoughTimeSinceLastBeat = timestamp - lastBeatTimeRef.current > MIN_BEAT_INTERVAL_MS;
    const floorFollowRate =
      smoothedBassEnergyRef.current < energyFloorRef.current
        ? ENERGY_FLOOR_FALL
        : ENERGY_FLOOR_RISE;
     
    energyFloorRef.current = lerp(
      energyFloorRef.current,
      smoothedBassEnergyRef.current,
      floorFollowRate
    );

    const dynamicThreshold =
      Math.max(historyAverage, energyFloorRef.current) * BEAT_THRESHOLD_MULTIPLIER +
      historyStdDev * 0.9;
    const relativeEnergy = smoothedBassEnergyRef.current - energyFloorRef.current;
 
    if (
      enoughTimeSinceLastBeat &&
      smoothedBassEnergyRef.current > dynamicThreshold &&
      bassRise > MIN_BEAT_DELTA &&
      relativeEnergy > MIN_BEAT_DELTA * 2
    ) {
      const beatStrength = Math.min(
        1.5,
        (smoothedBassEnergyRef.current - dynamicThreshold) * 6.5 +
          relativeEnergy * 3.2
      );

      beatPulseRef.current = Math.max(beatPulseRef.current, beatStrength);
      lastBeatTimeRef.current = timestamp;
    }

    bassHistory.push(smoothedBassEnergyRef.current);
    if (bassHistory.length > BEAT_HISTORY_SIZE) {
      bassHistory.shift();
    }

    beatPulseRef.current *= BEAT_PULSE_DECAY;

    const bodyPulse = smoothedAmplitudeRef.current * 42;
    const bassPulse = Math.max(0, relativeEnergy) * 92;
    const beatPulse = Math.pow(beatPulseRef.current, 1.05) * 86;

    return BASE_SIZE + bodyPulse + bassPulse + beatPulse + blobPulseRef.current * 20;
  };

  const computeIdleSize = (deltaMs) => {
    idlePhaseRef.current += deltaMs * IDLE_SPEED;
    return BASE_SIZE + Math.sin(idlePhaseRef.current) * IDLE_AMPLITUDE + blobPulseRef.current * 14;
  };

  const updateFloatingTokens = (timestamp) => {
    const nextTokens = tokensRef.current.map((token) => {
      if (token.animationState === "dragging") {
        return token;
      }

      if (token.animationState === "absorbing") {
        const progress = clamp((timestamp - token.snapStartTime) / ABSORB_DURATION_MS, 0, 1);
        const eased = 1 - Math.pow(1 - progress, 3);

        if (progress >= 1) {
          return {
            ...token,
            x: token.originalX,
            y: token.originalY,
            opacity: 0,
            scale: 0.8,
            animationState: "returning",
            snapStartTime: timestamp
          };
        }

        return {
          ...token,
          x: lerp(token.snapStartX, token.snapTargetX, eased),
          y: lerp(token.snapStartY, token.snapTargetY, eased),
          opacity: lerp(1, 0, eased),
          scale: lerp(1, 0.35, eased)
        };
      }

      if (token.animationState === "returning") {
        const progress = clamp((timestamp - token.snapStartTime) / RETURN_DURATION_MS, 0, 1);
        const eased = 1 - Math.pow(1 - progress, 3);

        if (progress >= 1) {
          return {
            ...token,
            x: token.originalX,
            y: token.originalY,
            opacity: 1,
            scale: 1,
            animationState: "idle"
          };
        }

        return {
          ...token,
          x: token.originalX,
          y: token.originalY,
          opacity: lerp(0, 1, eased),
          scale: lerp(0.8, 1, eased)
        };
      }

      if (token.animationState === "clickBounce") {
        const progress = clamp((timestamp - token.snapStartTime) / CLICK_BOUNCE_DURATION_MS, 0, 1);
        const bounceWave = Math.sin(progress * Math.PI);

        if (progress >= 1) {
          return {
            ...token,
            x: token.originalX,
            y: token.originalY,
            opacity: 1,
            scale: 1,
            animationState: "idle"
          };
        }

        const floatOffset = Math.sin(timestamp * token.floatSpeed + token.phase) * token.floatAmplitude;
        return {
          ...token,
          x: token.originalX,
          y: token.originalY + floatOffset,
          opacity: 1,
          scale: 1 + bounceWave * 0.2
        };
      }

      if (token.animationState === "snapping") {
        const progress = clamp((timestamp - token.snapStartTime) / SNAP_DURATION_MS, 0, 1);
        const eased = 1 - Math.pow(1 - progress, 3);

        if (progress >= 1) {
          return {
            ...token,
            x: token.originalX,
            y: token.originalY,
            opacity: 1,
            scale: 1,
            animationState: "idle"
          };
        }

        return {
          ...token,
          x: lerp(token.snapStartX, token.originalX, eased),
          y: lerp(token.snapStartY, token.originalY, eased),
          opacity: 1,
          scale: 1
        };
      }

      const driftX = Math.cos(timestamp * token.floatSpeed * 0.65 + token.phase) * 4;
      const driftY = Math.sin(timestamp * token.floatSpeed + token.phase) * token.floatAmplitude;

      const depthEffects = getDepthEffects(token.depth);
      const parallaxX = smoothedParallaxRef.current.x * depthEffects.parallaxIntensity;
      const parallaxY = smoothedParallaxRef.current.y * depthEffects.parallaxIntensity;

      return {
        ...token,
        x: token.originalX + driftX + parallaxX,
        y: token.originalY + driftY + parallaxY,
        opacity: 1,
        scale: 1,
        animationState: "idle"
      };
    });

    tokensRef.current = nextTokens;
    setTokens(nextTokens);
  };

  const startAnimationLoop = () => {
    if (animationFrameRef.current) return;

    const tick = (timestamp) => {
      if (!lastFrameTimeRef.current) {
        lastFrameTimeRef.current = timestamp;
      }

      const deltaMs = timestamp - lastFrameTimeRef.current;
      lastFrameTimeRef.current = timestamp;

      blobPulseRef.current = lerp(blobPulseRef.current, 0, 0.1);
      setBlobPulse(blobPulseRef.current);

      // Smooth parallax movement
      smoothedParallaxRef.current.x = lerp(smoothedParallaxRef.current.x, mouseParallaxRef.current.x, 0.12);
      smoothedParallaxRef.current.y = lerp(smoothedParallaxRef.current.y, mouseParallaxRef.current.y, 0.12);
      setParallaxOffset({ ...smoothedParallaxRef.current });

      targetSizeRef.current =
        modeRef.current === "music" ? computeSmoothedAudioSize(timestamp) : computeIdleSize(deltaMs);

      currentSizeRef.current = lerp(currentSizeRef.current, targetSizeRef.current, SIZE_LERP);
      setSize(currentSizeRef.current);
      updateFloatingTokens(timestamp);
      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);
  };

  const persistTokenPosition = (tokenId) => {
    const nextTokens = tokensRef.current.map((token) =>
      token.id === tokenId
        ? {
            ...token,
            originalX: token.x,
            originalY: token.y,
            animationState: "idle",
            opacity: 1,
            scale: 1
          }
        : token
    );

    tokensRef.current = nextTokens;
    setTokens(nextTokens);
  };

  const absorbTokenIntoBlob = (tokenId, blobRect) => {
    const now = performance.now();
    const centerX = blobRect.left + blobRect.width / 2 - TOKEN_SIZE / 2;
    const centerY = blobRect.top + blobRect.height / 2 - TOKEN_SIZE / 2;

    const nextTokens = tokensRef.current.map((token) =>
      token.id === tokenId
        ? {
            ...token,
            animationState: "absorbing",
            snapStartX: token.x,
            snapStartY: token.y,
            snapTargetX: centerX,
            snapTargetY: centerY,
            snapStartTime: now,
            opacity: 1,
            scale: 1
          }
        : token
    );

    tokensRef.current = nextTokens;
    setTokens(nextTokens);
  };

  const triggerClickBounce = (tokenId) => {
    const now = performance.now();
    const nextTokens = tokensRef.current.map((token) =>
      token.id === tokenId
        ? {
            ...token,
            animationState: "clickBounce",
            snapStartTime: now,
            opacity: 1,
            scale: 1
          }
        : token
    );

    tokensRef.current = nextTokens;
    setTokens(nextTokens);
  };

  const handlePointerMove = (event) => {
    if (draggedTokenIdRef.current == null) return;

    const deltaX = event.clientX - pointerStartRef.current.x;
    const deltaY = event.clientY - pointerStartRef.current.y;
    if (!pointerStartRef.current.moved && Math.hypot(deltaX, deltaY) > DRAG_THRESHOLD) {
      pointerStartRef.current.moved = true;
    }

    const nextTokens = tokensRef.current.map((token) => {
      if (token.id !== draggedTokenIdRef.current) {
        return token;
      }

      return {
        ...token,
        x: event.clientX - dragPointerOffsetRef.current.x,
        y: event.clientY - dragPointerOffsetRef.current.y,
        animationState: "dragging",
        opacity: 1,
        scale: 1.06
      };
    });

    tokensRef.current = nextTokens;
    setTokens(nextTokens);
  };

  const handlePointerUp = async () => {
    const draggedId = draggedTokenIdRef.current;
    if (draggedId == null) return;

    const token = tokensRef.current.find((item) => item.id === draggedId);
    const blobRect = blobRef.current?.getBoundingClientRect();
    const wasClick = !pointerStartRef.current.moved;
    let absorbed = false;

    if (token && blobRect) {
      const tokenRect = {
        left: token.x,
        top: token.y,
        right: token.x + TOKEN_SIZE,
        bottom: token.y + TOKEN_SIZE
      };

      const overlapsBlob =
        tokenRect.right >= blobRect.left &&
        tokenRect.left <= blobRect.right &&
        tokenRect.bottom >= blobRect.top &&
        tokenRect.top <= blobRect.bottom;

      if (overlapsBlob) {
        await activateTokenType(token.type);
        absorbTokenIntoBlob(draggedId, blobRect);
        absorbed = true;
      }
    }

    draggedTokenIdRef.current = null;
    setDraggedTokenId(null);
    pointerStartRef.current = { x: 0, y: 0, moved: false };

    if (absorbed) return;
    if (wasClick) {
      triggerClickBounce(draggedId);
      return;
    }
    persistTokenPosition(draggedId);
  };

  const handleTokenPointerDown = (event, tokenId) => {
    event.preventDefault();

    const token = tokensRef.current.find((item) => item.id === tokenId);
    if (!token) return;

    draggedTokenIdRef.current = tokenId;
    setDraggedTokenId(tokenId);
    dragPointerOffsetRef.current = {
      x: event.clientX - token.x,
      y: event.clientY - token.y
    };
    pointerStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      moved: false
    };

    const nextTokens = tokensRef.current.map((item) =>
      item.id === tokenId
        ? {
            ...item,
            animationState: "dragging",
            opacity: 1,
            scale: 1.06
          }
        : item
    );

    tokensRef.current = nextTokens;
    setTokens(nextTokens);
  };

  const resetAudioState = async () => {
    effectStackRef.current = [];
    setEffectStack([]);
    smoothedAmplitudeRef.current = 0;
    smoothedBassEnergyRef.current = 0;
    beatPulseRef.current = 0;
    beatHistoryRef.current = [];
    energyFloorRef.current = 0;
    lastBeatTimeRef.current = 0;
    blobPulseRef.current = 0;
    if (audioRef.current) {
      audioRef.current.playbackRate = 1;
    }
    await rebuildAudioGraph([]);
  };

  const handleFileUpload = async (event) => {
    const files = Array.from(event.target.files || []).filter((file) =>
      file.type.startsWith("audio/")
    );
    if (files.length === 0) return;

    playlistUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    const nextPlaylist = files.map((file) => URL.createObjectURL(file));
    playlistUrlsRef.current = nextPlaylist;
      
    setPlaylist(nextPlaylist);
    setCurrentTrackIndex(0);
    setIsPlaying(false);
    setMode("idle");
    modeRef.current = "idle";
     
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = nextPlaylist[0];
      audioRef.current.load();
    }

    await resetAudioState();
  };

  const stopBlobAnimation = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    lastFrameTimeRef.current = 0;
  };

  useEffect(() => {
    effectStackRef.current = effectStack;
  }, [effectStack]);

  useEffect(() => {
    const initialTokens = createTokenState();
    tokensRef.current = initialTokens;
    setTokens(initialTokens);
    startAnimationLoop();

    const handleResize = () => {
      const resizedTokens = createTokenState(window.innerWidth, window.innerHeight);
      tokensRef.current = resizedTokens;
      setTokens(resizedTokens);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      stopBlobAnimation();
      playlistUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [currentTrackIndex, isPlaying]);

  useEffect(() => {
    const handleMouseMove = (event) => {
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      
      // Calculate parallax offset from center, normalized to -1 to 1
      const offsetX = (event.clientX - centerX) / centerX;
      const offsetY = (event.clientY - centerY) / centerY;
      
      // Scale parallax intensity (28 pixels max deviation)
      mouseParallaxRef.current = {
        x: offsetX * 28,
        y: offsetY * 28
      };
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  useEffect(() => {
    if (!audioRef.current || !currentTrackUrl) return;

    audioRef.current.src = currentTrackUrl;
    audioRef.current.load();
  }, [currentTrackUrl]);

  const handleBlobClick = async () => {
    if (draggedTokenIdRef.current != null) return;

    if (!playlist.length) {
      fileInputRef.current?.click();
      return;
    }

    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      beatPulseRef.current = 0;
      energyFloorRef.current = smoothedBassEnergyRef.current;
      setMode("idle");
      modeRef.current = "idle";
      return;
    }

    await ensureAudioContext();
    await rebuildAudioGraph(effectStackRef.current);
    await audioRef.current.play();
    setIsPlaying(true);
    setMode("music");
    modeRef.current = "music";
  };

  const blobScale =
    mode === "music"
      ? Math.min(1.08, size / BASE_SIZE)
      : 1 + blobPulse * 0.022;

  return (
    <div
      style={{
        ...styles.page,
        backgroundImage: `linear-gradient(180deg, rgba(2, 10, 17, 0.2), rgba(2, 10, 17, 0.68)), url(${muniverseBg})`,
        backgroundPosition: `${parallaxOffset.x * 0.1}px ${parallaxOffset.y * 0.1}px`
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        multiple
        style={styles.hiddenInput}
        onChange={(event) => {
          void handleFileUpload(event);
        }}
      />
      <audio ref={audioRef} src={currentTrackUrl || ""} />

      <div style={styles.topPanel}>
        <h1 style={styles.title}></h1>

      </div>

      <div style={styles.scene}>
        {tokens.map((token) => {
          const depthEffects = getDepthEffects(token.depth);
          const parallaxX = parallaxOffset.x * depthEffects.parallaxIntensity;
          const parallaxY = parallaxOffset.y * depthEffects.parallaxIntensity;
          
          return (
            <button
              key={token.id}
              type="button"
              aria-label={token.label}
              title={token.label}
              onPointerDown={(event) => handleTokenPointerDown(event, token.id)}
              style={{
                ...styles.tokenButton,
                left: token.x,
                top: token.y,
                zIndex: draggedTokenId === token.id ? 6 : 2 + token.depth,
                transition:
                  token.animationState === "dragging"
                    ? "none"
                    : "transform 420ms cubic-bezier(0.22, 1, 0.36, 1), opacity 320ms ease-out, filter 180ms ease-out",
                opacity: token.opacity * depthEffects.opacityMultiplier,
                transform: `translate3d(${parallaxX}px, ${parallaxY}px, 0) scale(${token.scale * depthEffects.scaleMultiplier})`,
                filter:
                  token.animationState === "dragging"
                    ? `drop-shadow(0 18px 34px rgba(0, 0, 0, 0.34)) blur(0px)`
                    : `drop-shadow(0 14px 24px rgba(0, 0, 0, 0.24)) blur(${depthEffects.blur}px)`
              }}
            >
              <img src={token.image} alt={token.label} style={styles.tokenImage} draggable={false} />
            </button>
          );
        })}

        <button
          ref={blobRef}
          type="button"
          onClick={() => {
            void handleBlobClick();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const files = Array.from(e.dataTransfer.files).filter((file) =>
              file.type.startsWith("audio/")
            );

            if (files.length === 0) return;

            // Create a synthetic event object similar to what handleFileUpload expects
            const syntheticEvent = {
              target: {
                files: files
              }
            };

            await handleFileUpload(syntheticEvent);
          }}
          aria-label={playlist.length ? "Play or pause music" : "Upload music"}
          style={{
            ...styles.blobButton,
            width: size,
            height: size,
            transform: `translate(-50%, -50%) scale(${blobScale}) perspective(1200px) rotateX(${parallaxOffset.y * 0.04}deg) rotateY(${parallaxOffset.x * 0.04}deg)`,
            boxShadow: `0 30px 80px rgba(0, 0, 0, 0.3), inset 0 -20px 40px rgba(0, 0, 0, 0.2)`
          }}
        >
          <img src={blobImage} alt="Central music blob" style={styles.blobImage} draggable={false} />
          <div style={styles.blobLabel}>
            <span style={styles.blobAction}>{playlist.length ? "Play / Pause" : "Upload Music"}</span>
            <span style={styles.blobHint}>
            </span>
          </div>
        </button>
      </div>


    </div>
  );
}

const styles = {
  page: {
    position: "relative",
    width: "100vw",
    minHeight: "100vh",
    overflow: "hidden",
    color: "#f4fbff",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    backgroundSize: "cover",
    fontFamily: '"Avenir Next", "Trebuchet MS", sans-serif'
  },
  hiddenInput: {
    display: "none"
  },
  topPanel: {
    position: "absolute",
    top: "clamp(24px, 4vw, 40px)",
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "10px",
    width: "min(92vw, 760px)",
    zIndex: 4,
    textAlign: "center"
  },
  eyebrow: {
    margin: 0,
    fontSize: "12px",
    letterSpacing: "0.28em",
    textTransform: "uppercase",
    color: "rgba(237, 248, 255, 0.78)"
  },
  title: {
    margin: 0,
    fontSize: "clamp(2.6rem, 5vw, 4.75rem)",
    fontWeight: 600,
    letterSpacing: "0.04em",
    textShadow: "0 6px 30px rgba(0, 0, 0, 0.35)"
  },
  statusBar: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: "12px"
  },
  statusChip: {
    padding: "10px 16px",
    borderRadius: "999px",
    background: "rgba(7, 21, 31, 0.48)",
    border: "1px solid rgba(255, 255, 255, 0.14)",
    boxShadow: "0 10px 24px rgba(0, 0, 0, 0.18)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    fontSize: "13px",
    letterSpacing: "0.01em"
  },
  scene: {
    position: "relative",
    width: "100%",
    minHeight: "100vh"
  },
  tokenButton: {
    position: "absolute",
    width: `${TOKEN_SIZE}px`,
    height: `${TOKEN_SIZE}px`,
    padding: 0,
    border: "none",
    background: "transparent",
    borderRadius: "50%",
    cursor: "grab",
    userSelect: "none",
    touchAction: "none"
  },
  tokenImage: {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "contain",
    pointerEvents: "none"
  },
  blobButton: {
    position: "absolute",
    top: "50%",
    left: "50%",
    padding: 0,
    border: "none",
    background: "transparent",
    borderRadius: "50%",
    cursor: "pointer",
    transition:
      "width 0.12s ease-out, height 0.12s ease-out, box-shadow 0.12s ease-out, transform 0.08s ease-out",
    zIndex: 5,
    transformStyle: "preserve-3d"
  },
  blobImage: {
    display: "block",
    width: "100%",
    height: "100%",
    borderRadius: "50%",
    objectFit: "cover",
    pointerEvents: "none"
  },
  blobLabel: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    padding: "22%",
    borderRadius: "50%",
    background:
      "radial-gradient(circle, rgba(5, 16, 24, 0.08) 0%, rgba(5, 16, 24, 0.18) 56%, rgba(5, 16, 24, 0.34) 100%)",
    color: "#f5feff",
    textAlign: "center"
  },
  blobAction: {
    fontSize: "clamp(0.95rem, 1.3vw, 1.1rem)",
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    textShadow: "0 4px 16px rgba(0, 0, 0, 0.34)"
  },
  blobHint: {
    fontSize: "clamp(0.72rem, 0.95vw, 0.84rem)",
    lineHeight: 1.4,
    color: "rgba(244, 251, 255, 0.88)",
    textShadow: "0 4px 12px rgba(0, 0, 0, 0.3)"
  },
  bottomPanel: {
    position: "absolute",
    left: "50%",
    bottom: "clamp(20px, 4vw, 34px)",
    transform: "translateX(-50%)",
    width: "min(92vw, 640px)",
    zIndex: 4,
    textAlign: "center"
  },
  bottomText: {
    margin: 0,
    padding: "12px 16px",
    borderRadius: "18px",
    background: "rgba(6, 18, 27, 0.34)",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    boxShadow: "0 14px 30px rgba(0, 0, 0, 0.2)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    fontSize: "13px",
    lineHeight: 1.5,
    color: "rgba(244, 251, 255, 0.86)"
  }
};

export default App;