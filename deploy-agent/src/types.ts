export type DeployRequest = {
  appName: string;
  sourcePath: string;
  ownerObjectId: string;
  description: string;
  revision: string;
};

export type DeployResult = {
  appName: string;
  port: number;
  url: string;
};

export interface Runner {
  deploy(request: DeployRequest): Promise<DeployResult>;
}
