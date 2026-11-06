import React from 'react';
import { Composition, type CalculateMetadataFunction } from 'remotion';
import { newProject } from '../core/ops';
import { FPS, type CompProps } from '../core/schema';
import { outputFrames, outputSize } from '../core/timeline';
import { Main } from './Main';

const defaultProps: CompProps = {
  project: newProject('bos', 'Boş', new Date(0).toISOString()),
  assets: {},
  outputId: '',
  variant: 'full',
  target: 'render',
  luts: {},
};

export const calculateMetadata: CalculateMetadataFunction<CompProps> = ({ props }) => {
  const output = props.project.outputs.find((o) => o.id === props.outputId) ?? props.project.outputs[0];
  if (!output) return { width: 1080, height: 1920, durationInFrames: 1 };
  return { ...outputSize(output), durationInFrames: outputFrames(props.project, output) };
};

export const Root: React.FC = () => (
  <Composition
    id="Fabrika"
    component={Main}
    fps={FPS}
    width={1080}
    height={1920}
    durationInFrames={1}
    defaultProps={defaultProps}
    calculateMetadata={calculateMetadata}
  />
);
