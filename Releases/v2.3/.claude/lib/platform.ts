/**
 * Platform Abstraction Module
 *
 * Provides OS-aware functions for cross-platform compatibility.
 * Centralizes all platform-specific logic in one place.
 *
 * Supported platforms:
 * - darwin (macOS)
 * - linux (native Linux, WSL)
 */

import * as os from "os";
import { existsSync } from "fs";
import { spawn, spawnSync } from "child_process";

// ============================================================================
// Platform Detection
// ============================================================================

export const platform = os.platform();
export const isMac = platform === "darwin";
export const isLinux = platform === "linux";
export const isWSL = isLinux && (
  process.env.WSL_DISTRO_NAME !== undefined ||
  process.env.WSLENV !== undefined ||
  existsSync("/proc/sys/fs/binfmt_misc/WSLInterop")
);

export type PlatformType = "darwin" | "linux" | "wsl";

export function getPlatformType(): PlatformType {
  if (isMac) return "darwin";
  if (isWSL) return "wsl";
  return "linux";
}

// ============================================================================
// Audio Playback
// ============================================================================

export interface AudioPlayer {
  command: string;
  args: (file: string, volume?: number) => string[];
  available: boolean;
}

/**
 * Detect available audio player on the system
 */
function detectAudioPlayer(): AudioPlayer {
  // macOS: afplay is always available
  if (isMac) {
    return {
      command: "/usr/bin/afplay",
      args: (file, volume = 1.0) => ["-v", volume.toString(), file],
      available: true
    };
  }

  // WSL: Use PowerShell MediaPlayer (avoids WSLg audio issues)
  if (isWSL) {
    return {
      command: "powershell.exe",
      args: (file, volume = 1.0) => [
        "-NoProfile", "-Command",
        `$p = New-Object Media.SoundPlayer '${file.replace(/'/g, "''")}'; $p.PlaySync()`
      ],
      available: true
    };
  }

  // Linux: Try mpv first (best quality), then aplay, then paplay
  const players = [
    {
      command: "mpv",
      args: (file: string, volume = 1.0) => [
        "--no-terminal",
        `--volume=${Math.round(volume * 100)}`,
        file
      ]
    },
    {
      command: "paplay",
      args: (file: string, _volume?: number) => [file]
    },
    {
      command: "aplay",
      args: (file: string, _volume?: number) => [file]
    }
  ];

  for (const player of players) {
    const result = spawnSync("which", [player.command], { encoding: "utf-8" });
    if (result.status === 0) {
      return { ...player, available: true };
    }
  }

  // No player found
  return {
    command: "echo",
    args: () => ["Audio playback not available - install mpv, pulseaudio, or alsa-utils"],
    available: false
  };
}

// Cache the detected audio player
let _audioPlayer: AudioPlayer | null = null;

export function getAudioPlayer(): AudioPlayer {
  if (!_audioPlayer) {
    _audioPlayer = detectAudioPlayer();
  }
  return _audioPlayer;
}

/**
 * Play an audio file using the appropriate system player
 */
export async function playAudio(filePath: string, volume = 1.0): Promise<void> {
  const player = getAudioPlayer();

  if (!player.available) {
    console.warn("No audio player available on this system");
    return;
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(player.command, player.args(filePath, volume));

    proc.on("error", (error) => {
      console.error(`Error playing audio with ${player.command}:`, error);
      reject(error);
    });

    proc.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${player.command} exited with code ${code}`));
      }
    });
  });
}

// ============================================================================
// Desktop Notifications
// ============================================================================

export interface NotificationCommand {
  command: string;
  args: (title: string, message: string, options?: { sound?: string }) => string[];
  available: boolean;
}

function detectNotificationSystem(): NotificationCommand {
  // macOS: osascript
  if (isMac) {
    return {
      command: "/usr/bin/osascript",
      args: (title, message, options) => {
        const soundPart = options?.sound ? ` sound name "${options.sound}"` : "";
        const escapedTitle = title.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const escapedMessage = message.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        return ["-e", `display notification "${escapedMessage}" with title "${escapedTitle}"${soundPart}`];
      },
      available: true
    };
  }

  // Linux/WSL: notify-send
  const result = spawnSync("which", ["notify-send"], { encoding: "utf-8" });
  if (result.status === 0) {
    return {
      command: "notify-send",
      args: (title, message, _options) => [title, message],
      available: true
    };
  }

  // Fallback: no notification system
  return {
    command: "echo",
    args: (title, message) => [`[${title}] ${message}`],
    available: false
  };
}

let _notificationCmd: NotificationCommand | null = null;

export function getNotificationCommand(): NotificationCommand {
  if (!_notificationCmd) {
    _notificationCmd = detectNotificationSystem();
  }
  return _notificationCmd;
}

/**
 * Send a desktop notification using the appropriate system method
 */
export async function sendDesktopNotification(
  title: string,
  message: string,
  options?: { sound?: string }
): Promise<boolean> {
  const notifier = getNotificationCommand();

  try {
    const proc = spawn(notifier.command, notifier.args(title, message, options));

    return new Promise((resolve) => {
      proc.on("error", () => resolve(false));
      proc.on("exit", (code) => resolve(code === 0));
    });
  } catch {
    return false;
  }
}

// ============================================================================
// File System Paths
// ============================================================================

/**
 * Get the home directory path prefix for the current platform
 * macOS: /Users/username -> "Users"
 * Linux: /home/username -> "home"
 */
export function getHomePathPrefix(): string {
  return isMac ? "Users" : "home";
}

/**
 * Get the Claude projects directory path pattern
 * This is used by SessionHarvester and ActivityParser
 */
export function getProjectsPathPattern(): string {
  const username = process.env.USER || os.userInfo().username;
  const prefix = getHomePathPrefix();
  return `-${prefix}-${username}--claude`;
}

// ============================================================================
// Shell Commands
// ============================================================================

/**
 * Get the stat command for file modification time
 * Returns a shell command string that outputs unix timestamp
 */
export function getStatMtimeCommand(filepath: string): string {
  if (isMac) {
    // BSD stat (macOS)
    return `stat -f %m "${filepath}"`;
  }
  // GNU stat (Linux)
  return `stat -c %Y "${filepath}"`;
}

/**
 * Get the sed in-place edit flag
 * macOS: sed -i ''
 * Linux: sed -i
 */
export function getSedInPlaceArgs(): string[] {
  return isMac ? ["-i", ""] : ["-i"];
}

/**
 * Get the command to open a URL or file
 * macOS: open
 * Linux: xdg-open
 */
export function getOpenCommand(): string {
  return isMac ? "open" : "xdg-open";
}

/**
 * Get clipboard commands
 */
export function getClipboardCommands(): { copy: string; paste: string } {
  if (isMac) {
    return { copy: "pbcopy", paste: "pbpaste" };
  }
  // Linux: prefer xclip, fallback to xsel
  const xclipResult = spawnSync("which", ["xclip"], { encoding: "utf-8" });
  if (xclipResult.status === 0) {
    return { copy: "xclip -selection clipboard", paste: "xclip -selection clipboard -o" };
  }
  return { copy: "xsel --clipboard --input", paste: "xsel --clipboard --output" };
}

// ============================================================================
// Service Management
// ============================================================================

export type ServiceManager = "launchd" | "systemd";

export function getServiceManager(): ServiceManager {
  return isMac ? "launchd" : "systemd";
}

/**
 * Get the service files directory
 * macOS: ~/Library/LaunchAgents
 * Linux: ~/.config/systemd/user
 */
export function getServiceFilesDir(): string {
  if (isMac) {
    return `${os.homedir()}/Library/LaunchAgents`;
  }
  return `${os.homedir()}/.config/systemd/user`;
}

// ============================================================================
// Platform Info
// ============================================================================

export function getPlatformInfo(): {
  platform: string;
  type: PlatformType;
  homePrefix: string;
  audioPlayer: string;
  notificationSystem: string;
  serviceManager: ServiceManager;
} {
  const audio = getAudioPlayer();
  const notifier = getNotificationCommand();

  return {
    platform: os.platform(),
    type: getPlatformType(),
    homePrefix: getHomePathPrefix(),
    audioPlayer: audio.available ? audio.command : "none",
    notificationSystem: notifier.available ? notifier.command : "none",
    serviceManager: getServiceManager()
  };
}
