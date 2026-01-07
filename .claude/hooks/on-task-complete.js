#!/usr/bin/env node

/**
 * ChromaDB hook for task completion
 * Triggers when a task is marked as done
 */

import { ChromaDBContextSaver, TRIGGER_EVENTS } from './chromadb-save-hook.js';
import fs from 'fs';

async function onTaskComplete() {
  try {
    // Read Claude's input about the completed task
    const input = JSON.parse(fs.readFileSync(0, 'utf-8'));
    
    const saver = new ChromaDBContextSaver();
    
    // Save context about task completion
    await saver.saveContext(TRIGGER_EVENTS.TASK_COMPLETE, {
      task: input.task || input.description || 'Unknown task',
      taskId: input.taskId || input.id,
      duration: input.duration,
      filesChanged: input.filesChanged || [],
      summary: input.summary || '',
      nextSteps: input.nextSteps || [],
    });
    
    // Also update Linear if it's a STA task
    if (input.task && input.task.includes('STA-')) {
      const { LinearUpdateSkill } = await import('../../../scripts/claude-linear-skill.js');
      const skill = new LinearUpdateSkill();
      
      if (skill.apiKey) {
        await skill.processUpdate(`${input.task} is completed`, {
          comment: input.summary,
        });
      }
    }
    
  } catch (error) {
    // Silently fail to not block Claude
    fs.appendFileSync(
      `${process.env.HOME}/.stackmemory/logs/hook-errors.log`,
      `[${new Date().toISOString()}] on-task-complete: ${error.message}\n`
    );
  }
}

onTaskComplete();