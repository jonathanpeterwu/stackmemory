/**
 * Sweep 1.5B Next-Edit Addon for StackMemory
 *
 * Provides next-edit predictions using the Sweep 1.5B model.
 * Model is downloaded from HuggingFace on first use.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface SweepPredictInput {
  file_path: string;
  current_content: string;
  original_content?: string;
  context_files?: Record<string, string>;
  recent_diffs?: Array<{
    file_path: string;
    original: string;
    updated: string;
  }>;
  max_tokens?: number;
  temperature?: number;
}

export interface SweepPredictResult {
  success: boolean;
  predicted_content?: string;
  file_path?: string;
  latency_ms?: number;
  tokens_generated?: number;
  error?: string;
  message?: string;
}

export interface SweepStatus {
  installed: boolean;
  model_downloaded: boolean;
  python_path?: string;
  model_path?: string;
  error?: string;
}

/**
 * Get the path to the Python script
 */
function getPythonScriptPath(): string {
  // Try multiple locations
  const locations = [
    join(__dirname, '..', 'python', 'sweep_predict.py'),
    join(__dirname, '..', '..', 'python', 'sweep_predict.py'),
    join(
      process.cwd(),
      'packages',
      'sweep-addon',
      'python',
      'sweep_predict.py'
    ),
  ];

  for (const loc of locations) {
    if (existsSync(loc)) {
      return loc;
    }
  }

  throw new Error('sweep_predict.py not found');
}

/**
 * Find Python executable
 */
async function findPython(): Promise<string> {
  const candidates = ['python3', 'python'];

  for (const cmd of candidates) {
    try {
      const result = await new Promise<string>((resolve, reject) => {
        const proc = spawn(cmd, ['--version']);
        let output = '';
        proc.stdout.on('data', (data) => (output += data));
        proc.stderr.on('data', (data) => (output += data));
        proc.on('close', (code) => {
          if (code === 0) resolve(cmd);
          else reject(new Error(`${cmd} not found`));
        });
        proc.on('error', reject);
      });
      return result;
    } catch {
      continue;
    }
  }

  throw new Error('Python not found. Install Python 3.10+');
}

/**
 * Check if Sweep addon is properly installed
 */
export async function checkStatus(): Promise<SweepStatus> {
  try {
    const pythonPath = await findPython();
    const scriptPath = getPythonScriptPath();

    // Check if model is downloaded
    const homeDir = process.env['HOME'] || process.env['USERPROFILE'] || '';
    const modelPath = join(
      homeDir,
      '.stackmemory',
      'models',
      'sweep',
      'sweep-next-edit-1.5b.q8_0.v2.gguf'
    );
    const modelDownloaded = existsSync(modelPath);

    return {
      installed: true,
      model_downloaded: modelDownloaded,
      python_path: pythonPath,
      model_path: modelDownloaded ? modelPath : undefined,
    };
  } catch (error) {
    return {
      installed: false,
      model_downloaded: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Run a prediction using the Sweep 1.5B model
 */
export async function predict(
  input: SweepPredictInput
): Promise<SweepPredictResult> {
  const pythonPath = await findPython();
  const scriptPath = getPythonScriptPath();

  return new Promise((resolve, reject) => {
    const proc = spawn(pythonPath, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => (stdout += data));
    proc.stderr.on('data', (data) => (stderr += data));

    proc.on('close', (code) => {
      try {
        if (stdout.trim()) {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } else if (code !== 0) {
          resolve({
            success: false,
            error: 'process_error',
            message: stderr || `Process exited with code ${code}`,
          });
        } else {
          resolve({
            success: false,
            error: 'no_output',
            message: 'No output from prediction script',
          });
        }
      } catch (e) {
        resolve({
          success: false,
          error: 'parse_error',
          message: `Failed to parse output: ${stdout}`,
        });
      }
    });

    proc.on('error', (error) => {
      resolve({
        success: false,
        error: 'spawn_error',
        message: error.message,
      });
    });

    // Send input to stdin
    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();
  });
}

/**
 * Predict next edit for a file with minimal input
 */
export async function predictNextEdit(
  filePath: string,
  currentContent: string,
  recentChanges?: { original: string; updated: string }
): Promise<SweepPredictResult> {
  const input: SweepPredictInput = {
    file_path: filePath,
    current_content: currentContent,
  };

  if (recentChanges) {
    input.original_content = recentChanges.original;
    input.recent_diffs = [
      {
        file_path: filePath,
        original: recentChanges.original,
        updated: recentChanges.updated,
      },
    ];
  }

  return predict(input);
}

export default {
  predict,
  predictNextEdit,
  checkStatus,
};
