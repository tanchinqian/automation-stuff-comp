declare module 'onnxruntime-web' {
  export type TensorDataType = 'float32' | 'float64' | 'int32' | 'int64' | 'uint8' | 'bool' | 'string';
  export type ExecutionProvider = 'webgpu' | 'wasm' | 'cpu' | string;

  export interface WasmEnv {
    wasmPaths?: string;
    numThreads?: number;
  }

  export interface Env {
    wasm: WasmEnv;
  }

  export const env: Env;

  export class Tensor {
    constructor(type: TensorDataType, data: ArrayBufferView | number[], dims: number[]);
    readonly data: ArrayBufferView;
    readonly dims: number[];
    readonly type: TensorDataType;
  }

  export interface InferenceSessionOptions {
    executionProviders?: ExecutionProvider[];
  }

  export interface InferenceSessionRunOptions {}

  export class InferenceSession {
    readonly inputNames: string[];
    readonly outputNames: string[];
    static create(
      uri: string,
      options?: InferenceSessionOptions,
    ): Promise<InferenceSession>;
    run(
      feeds: Record<string, Tensor>,
      options?: InferenceSessionRunOptions,
    ): Promise<Record<string, Tensor>>;
  }
}