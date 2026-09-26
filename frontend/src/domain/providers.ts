/** Remaining administration wire shapes from api/provider.py, the model families, and copilot.py. */
export type KeyProvider = 'openrouter' | 'siliconflow' | 'azure_openai' | 'zhipu'

export interface ProviderConfigDTO {
  api_host?: string
  api_version?: string
}

export interface ProviderStatusDTO {
  provider: string
  name: string
  configured: boolean
  key_preview: string | null
  extra_config?: ProviderConfigDTO
}

export interface MessageDTO { message: string }
export interface VerifyKeyDTO extends MessageDTO { valid: boolean }
export interface ProviderConfigResponseDTO extends MessageDTO {
  provider: string
  extra_config: ProviderConfigDTO
}

export interface AddModelRequestDTO {
  model_id: string
  display_name: string
}

export interface RemovedModelDTO extends MessageDTO { model_id: string }
export interface ModelMetadata {
  openrouter: { openrouter_id: string }
  siliconflow: { siliconflow_id: string }
  azure_openai: { azure_id: string }
  zhipu: { zhipu_id: string }
}
export type AddedModelDTO<P extends KeyProvider> = RemovedModelDTO & { display_name: string } & ModelMetadata[P]

// Copilot auth models omit provider; /api/models registry entries include it.
export interface CopilotModelDTO {
  id: string
  model: string
  display_name: string
}
export interface CopilotConnectDTO {
  user_code: string
  verification_uri: string
  expires_in: number
}
export type CopilotPollDTO =
  | { status: 'pending', slow_down?: boolean, interval?: number }
  | { status: 'connected', models: CopilotModelDTO[] }
export interface CopilotStatusDTO {
  connected: boolean
  has_valid_token: boolean
  models: CopilotModelDTO[]
}
