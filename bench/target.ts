import fs from "fs";
import https from "https";

// --- Types ---

export type TaskId = string;
export type Priority = "critical" | "high" | "normal" | "low";

export interface Task {
  id: TaskId;
  title: string;
  priority: Priority;
  assignee: string | null;
  completed: boolean;
}

export interface TaskFilter {
  priority?: Priority;
  assignee?: string;
  completed?: boolean;
}

export enum TaskEvent {
  Created = "created",
  Updated = "updated",
  Completed = "completed",
  Deleted = "deleted",
}

// --- Pure functions (no side effects) ---

export function filterTasks(tasks: Task[], filter: TaskFilter): Task[] {
  return tasks.filter((t) => {
    if (filter.priority && t.priority !== filter.priority) return false;
    if (filter.assignee && t.assignee !== filter.assignee) return false;
    if (filter.completed !== undefined && t.completed !== filter.completed)
      return false;
    return true;
  });
}

export function sortByPriority(tasks: Task[]): Task[] {
  const order: Record<Priority, number> = {
    critical: 0,
    high: 1,
    normal: 2,
    low: 3,
  };
  return [...tasks].sort((a, b) => order[a.priority] - order[b.priority]);
}

export const formatTaskSummary = (task: Task): string => {
  const status = task.completed ? "✓" : "○";
  const assignee = task.assignee ?? "unassigned";
  return `[${status}] ${task.title} (${task.priority}) — ${assignee}`;
};

// --- Effectful functions ---

export async function loadTasksFromDisk(path: string): Promise<Task[]> {
  const raw = fs.readFileSync(path, "utf-8");
  return JSON.parse(raw);
}

export async function saveTasksToDisk(
  path: string,
  tasks: Task[],
): Promise<void> {
  fs.writeFileSync(path, JSON.stringify(tasks, null, 2));
}

export async function fetchRemoteTasks(url: string): Promise<Task[]> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(JSON.parse(data)));
      res.on("error", reject);
    });
  });
}

export function logTaskEvent(event: TaskEvent, task: Task): void {
  console.log(`[${new Date().toISOString()}] ${event}: ${task.title}`);
}

// --- Class with mixed concerns ---

export class TaskManager {
  private tasks: Task[] = [];
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    this.tasks = await loadTasksFromDisk(this.filePath);
  }

  async save(): Promise<void> {
    await saveTasksToDisk(this.filePath, this.tasks);
  }

  add(task: Task): void {
    this.tasks.push(task);
    logTaskEvent(TaskEvent.Created, task);
  }

  complete(id: TaskId): Task | undefined {
    const task = this.tasks.find((t) => t.id === id);
    if (task) {
      task.completed = true;
      logTaskEvent(TaskEvent.Completed, task);
    }
    return task;
  }

  getFiltered(filter: TaskFilter): Task[] {
    return filterTasks(this.tasks, filter);
  }

  getSorted(): Task[] {
    return sortByPriority(this.tasks);
  }
}
