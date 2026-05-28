import type {
  BufferLayout,
  Device,
  PrimitiveTopology,
  RenderPass,
  VertexFormat,
} from '@luma.gl/core';
import { Buffer } from '@luma.gl/core';
import { Model } from '@luma.gl/engine';
import {
  COLOR_FS,
  LINE_SEGMENT_VS,
  POINT_INSTANCE_FS,
  POINT_INSTANCE_VS,
  POSITION_VS,
} from './shaders';

type TypedAttributeArray = Float32Array | Uint8Array | Uint32Array;

export interface WebGLAttributeBufferProps {
  data: TypedAttributeArray;
  format: VertexFormat;
  stepMode: BufferLayout['stepMode'];
}

export interface WebGLModelProps {
  shaderKind?: 'solid' | 'point' | 'line';
  topology: PrimitiveTopology;
  positions: Float32Array;
  indices?: Uint32Array;
  vertexCount?: number;
  instancePositions?: Float32Array;
  instanceCount?: number;
  isInstanced?: boolean;
  attributes?: Record<string, WebGLAttributeBufferProps>;
  uniforms: Record<string, unknown>;
}

export interface WebGLDrawableModel {
  update(props: WebGLModelProps): void;
  draw(renderPass: RenderPass): boolean | void;
  destroy(): void;
}

const BLEND_PARAMETERS = {
  depthWriteEnabled: false,
  depthCompare: 'always' as const,
  blend: true,
  blendColorOperation: 'add' as const,
  blendColorSrcFactor: 'src-alpha' as const,
  blendColorDstFactor: 'one-minus-src-alpha' as const,
  blendAlphaOperation: 'add' as const,
  blendAlphaSrcFactor: 'one' as const,
  blendAlphaDstFactor: 'one-minus-src-alpha' as const,
};

export class RetainedWebGLModel implements WebGLDrawableModel {
  private _model: Model;
  private _positionBuffer: Buffer;
  private _indexBuffer: Buffer | null = null;
  private _instanceBuffer: Buffer | null = null;
  private _attributeBuffers = new Map<string, Buffer>();
  private _positionData: Float32Array;
  private _indexData: Uint32Array | undefined;
  private _instanceData: Float32Array | undefined;
  private _attributeData = new Map<string, TypedAttributeArray>();

  constructor(
    private _device: Device,
    props: WebGLModelProps,
  ) {
    this._positionData = props.positions;
    this._indexData = props.indices;
    this._instanceData = props.instancePositions;
    this._positionBuffer = this._createVertexBuffer(props.positions);
    if (props.indices) {
      this._indexBuffer = this._createIndexBuffer(props.indices);
    }
    if (props.isInstanced && props.instancePositions) {
      this._instanceBuffer = this._createVertexBuffer(props.instancePositions);
    }
    this._replaceAttributeBuffers(props.attributes);

    const isInstanced = Boolean(props.isInstanced);
    const shaderKind = props.shaderKind ?? (isInstanced ? 'point' : 'solid');
    this._model = new Model(this._device, {
      vs: shaderKind === 'line'
        ? LINE_SEGMENT_VS
        : shaderKind === 'point'
          ? POINT_INSTANCE_VS
          : POSITION_VS,
      fs: shaderKind === 'point' ? POINT_INSTANCE_FS : COLOR_FS,
      topology: props.topology,
      vertexCount: props.vertexCount ?? props.positions.length / 2,
      indexBuffer: this._indexBuffer,
      isInstanced,
      instanceCount: props.instanceCount,
      bufferLayout: this._bufferLayout(props),
      attributes: this._attributes(),
      uniforms: props.uniforms,
      parameters: BLEND_PARAMETERS,
    });
  }

  update(props: WebGLModelProps): void {
    this._writeOrReplacePositionBuffer(props.positions);
    this._model.setVertexCount(props.vertexCount ?? props.positions.length / 2);
    this._writeOrReplaceIndexBuffer(props.indices);

    if (props.isInstanced && props.instancePositions) {
      this._writeOrReplaceInstanceBuffer(props.instancePositions);
    }
    if (props.isInstanced) {
      const instanceCount = props.instanceCount ??
        (props.instancePositions ? props.instancePositions.length / 2 : 0);
      this._model.setInstanceCount(instanceCount);
    }

    this._replaceAttributeBuffers(props.attributes);
    this._model.setAttributes(this._attributes(), { disableWarnings: true });
    Reflect.set(Reflect.get(this._model, 'props') as object, 'uniforms', props.uniforms);
  }

  draw(renderPass: RenderPass): boolean | void {
    return this._model.draw(renderPass);
  }

  destroy(): void {
    this._model.destroy();
    this._positionBuffer.destroy();
    this._indexBuffer?.destroy();
    this._instanceBuffer?.destroy();
    for (const buffer of this._attributeBuffers.values()) buffer.destroy();
    this._indexBuffer = null;
    this._instanceBuffer = null;
    this._attributeBuffers.clear();
  }

  private _attributes(): Record<string, Buffer> {
    const attributes: Record<string, Buffer> = {
      positions: this._positionBuffer,
    };
    if (this._instanceBuffer) attributes.instancePositions = this._instanceBuffer;
    for (const [name, buffer] of this._attributeBuffers) attributes[name] = buffer;
    return attributes;
  }

  private _bufferLayout(props: WebGLModelProps): BufferLayout[] {
    const layout: BufferLayout[] = [
      { name: 'positions', stepMode: 'vertex', format: 'float32x2' },
    ];
    if (props.isInstanced && props.instancePositions) {
      layout.push({ name: 'instancePositions', stepMode: 'instance', format: 'float32x2' });
    }
    for (const [name, attribute] of Object.entries(props.attributes ?? {})) {
      layout.push({
        name,
        stepMode: attribute.stepMode,
        format: attribute.format,
      });
    }
    return layout;
  }

  private _createVertexBuffer(data: Float32Array): Buffer {
    return this._device.createBuffer({
      usage: Buffer.VERTEX | Buffer.COPY_DST,
      data,
    });
  }

  private _createAttributeBuffer(data: TypedAttributeArray): Buffer {
    return this._device.createBuffer({
      usage: Buffer.VERTEX | Buffer.COPY_DST,
      data,
    });
  }

  private _createIndexBuffer(data: Uint32Array): Buffer {
    return this._device.createBuffer({
      usage: Buffer.INDEX | Buffer.COPY_DST,
      data,
    });
  }

  private _replaceAttributeBuffers(
    attributes: Record<string, WebGLAttributeBufferProps> | undefined,
  ): void {
    const names = new Set(Object.keys(attributes ?? {}));
    for (const [name, buffer] of this._attributeBuffers) {
      if (!names.has(name)) {
        buffer.destroy();
        this._attributeBuffers.delete(name);
        this._attributeData.delete(name);
      }
    }
    for (const [name, attribute] of Object.entries(attributes ?? {})) {
      const existing = this._attributeBuffers.get(name);
      if (existing && this._attributeData.get(name) === attribute.data) {
        continue;
      }
      if (existing && existing.byteLength === attribute.data.byteLength) {
        existing.write(attribute.data);
      } else {
        existing?.destroy();
        this._attributeBuffers.set(name, this._createAttributeBuffer(attribute.data));
      }
      this._attributeData.set(name, attribute.data);
    }
  }

  private _writeOrReplacePositionBuffer(data: Float32Array): void {
    if (this._positionData === data) return;
    if (this._positionBuffer.byteLength === data.byteLength) {
      this._positionBuffer.write(data);
      this._positionData = data;
      return;
    }
    this._positionBuffer.destroy();
    this._positionBuffer = this._createVertexBuffer(data);
    this._positionData = data;
  }

  private _writeOrReplaceIndexBuffer(data: Uint32Array | undefined): void {
    if (this._indexData === data) return;
    if (!data) {
      if (this._indexBuffer) {
        this._indexBuffer.destroy();
        this._indexBuffer = null;
        this._model.setIndexBuffer(null);
      }
      this._indexData = data;
      return;
    }
    if (this._indexBuffer && this._indexBuffer.byteLength === data.byteLength) {
      this._indexBuffer.write(data);
      this._indexData = data;
      return;
    }
    this._indexBuffer?.destroy();
    this._indexBuffer = this._createIndexBuffer(data);
    this._model.setIndexBuffer(this._indexBuffer);
    this._indexData = data;
  }

  private _writeOrReplaceInstanceBuffer(data: Float32Array): void {
    if (this._instanceData === data) return;
    if (this._instanceBuffer && this._instanceBuffer.byteLength === data.byteLength) {
      this._instanceBuffer.write(data);
      this._instanceData = data;
      return;
    }
    this._instanceBuffer?.destroy();
    this._instanceBuffer = this._createVertexBuffer(data);
    this._instanceData = data;
  }
}

export function createRetainedWebGLModel(
  device: Device,
  props: WebGLModelProps,
): WebGLDrawableModel {
  return new RetainedWebGLModel(device, props);
}
