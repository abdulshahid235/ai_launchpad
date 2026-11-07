import type { DeployRequest, DeployResult, Runner } from "./types.ts";

export class DockerRunner implements Runner {
  async deploy(_request: DeployRequest): Promise<DeployResult> {
    throw new Error("not implemented");
  }
}
