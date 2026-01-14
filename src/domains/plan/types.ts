/**
 * Plan type definitions
 */

export interface Plan {
  name: string;
  path: string;
  createdAt: string;
  isActive: boolean;
}

export interface PlanTemplate {
  name: string;
  content: string;
}
