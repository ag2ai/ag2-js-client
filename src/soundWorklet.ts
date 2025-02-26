export const ResamplerProcessorWorklet = `
class ResamplerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);

    this.inputSampleRate = sampleRate;
    this.outputSampleRate = options.processorOptions.outputSampleRate || 24000;
    this.ratio = this.inputSampleRate / this.outputSampleRate;
    this.resampledBuffer = []; // Store resampled data to send to the main thread
    this.processCount = 0;  //Counter.
    this.pcmData = new Int16Array(8196);
    this.pcmIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (input.length === 0 || input[0].length === 0) {
      return true; // No input, nothing to do
    }

    const inputChannel = input[0];

    // Resample the data
    this.resample(inputChannel);

    this.processCount++; //Increment process count
    let messageRate = 100; //Message sent every 100 process calls.
    // Send the resampled data to the main thread (send in chunks)
    if (this.processCount % messageRate === 0 && this.pcmIndex > 0) {
      // Convert Int16Array to a binary buffer (ArrayBuffer)
      const pcmBuffer = new ArrayBuffer(this.pcmIndex * 2); // 2 bytes per sample
      const pcmView = new DataView(pcmBuffer);
      for (let i = 0; i < this.pcmIndex; i++) {
        const pcmData_i = this.pcmData[i];
        if (pcmData_i) {
          pcmView.setInt16(i * 2, pcmData_i, true); // true means little-endian
        }
      }
      this.port.postMessage({ type: 'resampledData', data: pcmBuffer }); 
      this.pcmData = new Int16Array(8196);
      this.pcmIndex = 0;
    }

    return true;
  }

  resample(inputChannel) {
    let inputIndex = 0;
    const howMany = Math.floor(inputChannel.length / this.ratio)
    let outputIndex;
    for (outputIndex = 0; outputIndex < howMany; outputIndex++) {
      const inputIndexFloat = outputIndex * this.ratio;
      inputIndex = Math.floor(inputIndexFloat);

      if (inputIndex < inputChannel.length) {
        this.pcmData[this.pcmIndex+outputIndex] = Math.max(-32768, Math.min(32767, inputChannel[inputIndex] * 32767));
      } else {
        break; //No more data, break out of loop
      }
    }
    this.pcmIndex += outputIndex;
  }
}

registerProcessor('resampler-processor', ResamplerProcessor);
`;

const script = new Blob([ResamplerProcessorWorklet], {
  type: 'application/javascript',
});
const src = URL.createObjectURL(script);
export const ResamplerProcessorSrc = src;
