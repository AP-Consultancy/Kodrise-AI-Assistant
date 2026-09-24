import type { ProjectContext, UserContext } from '../../shared/context/types';

export class UserContextProvider {
  get(userContext: UserContext | null | undefined): UserContext | null {
    if (!userContext) {
      return null;
    }
    const cleaned = this.cleanUser(userContext);
    return Object.keys(cleaned).length > 0 ? cleaned : null;
  }

  private cleanUser(input: UserContext): UserContext {
    const output: UserContext = {};
    if (input.name?.trim()) output.name = input.name.trim().slice(0, 120);
    if (input.role?.trim()) output.role = input.role.trim().slice(0, 120);
    if (input.experience?.trim()) output.experience = input.experience.trim().slice(0, 500);
    if (input.skills?.length) {
      output.skills = input.skills.map((skill) => skill.trim()).filter(Boolean).slice(0, 32);
    }
    if (input.preferences) {
      const preferences: Record<string, string> = {};
      for (const [key, value] of Object.entries(input.preferences)) {
        if (!key || /api[_-]?key|token|secret|password|credential/i.test(key)) {
          continue;
        }
        preferences[key.slice(0, 64)] = String(value).slice(0, 256);
      }
      if (Object.keys(preferences).length > 0) {
        output.preferences = preferences;
      }
    }
    return output;
  }
}

export class ProjectContextProvider {
  get(projectContext: ProjectContext | null | undefined): ProjectContext | null {
    if (!projectContext) {
      return null;
    }
    const cleaned = this.cleanProject(projectContext);
    return Object.keys(cleaned).length > 0 ? cleaned : null;
  }

  private cleanProject(input: ProjectContext): ProjectContext {
    const output: ProjectContext = {};
    if (input.projectName?.trim()) output.projectName = input.projectName.trim().slice(0, 160);
    if (input.description?.trim()) output.description = input.description.trim().slice(0, 1200);
    if (input.architecture?.trim()) output.architecture = input.architecture.trim().slice(0, 800);
    if (input.technologies?.length) {
      output.technologies = input.technologies
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 40);
    }
    if (input.responsibilities?.length) {
      output.responsibilities = input.responsibilities
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 40);
    }
    return output;
  }
}
