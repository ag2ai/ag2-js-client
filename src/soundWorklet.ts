export const ResamplerProcessorWorklet = `
class ResamplerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);

    this.inputSampleRate = sampleRate;
    this.outputSampleRate = options.processorOptions.outputSampleRate || 24000;
    this.ratio = this.inputSampleRate / this.outputSampleRate;
    this.resampledBuffer = []; // Store resampled data to send to the main thread
    this.processCount = 0;  //Counter.
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (input.length === 0 || input[0].length === 0) {
      return true; // No input, nothing to do
    }

    const inputChannel = input[0];
    const outputChannel = output[0];

    // Pass the original input data to the output
    for (let i = 0; i < inputChannel.length; i++) {
      outputChannel[i] = inputChannel[i]; // Pass through original data
    }

    // Resample the data
    const resampledData = this.resample(inputChannel);
    this.resampledBuffer = this.resampledBuffer.concat(Array.from(resampledData));

    this.processCount++; //Increment process count
    let messageRate = 100; //Message sent every 100 process calls.
    // Send the resampled data to the main thread (send in chunks)
    if (this.processCount % messageRate === 0 && this.resampledBuffer.length > 0) {
      //Limit what we send.
      let sendCount = 256;
      let send = this.resampledBuffer.slice(0, sendCount);

      this.port.postMessage({ type: 'resampledData', data: send });  //Send only part of the resampledBuffer;

      //Purge the buffer.
      this.resampledBuffer = this.resampledBuffer.slice(sendCount);
    }

    return true;
  }

  resample(inputChannel) {
    const resampledData = [];
    let inputIndex = 0;

    for (let outputIndex = 0; outputIndex < inputChannel.length / this.ratio; outputIndex++) {
      const inputIndexFloat = outputIndex * this.ratio;
      inputIndex = Math.floor(inputIndexFloat);

      if (inputIndex < inputChannel.length) {
        resampledData.push(inputChannel[inputIndex]); // Replace with interpolation
      } else {
        break; //No more data, break out of loop
      }
    }

    return resampledData;
  }
}

registerProcessor('resampler-processor', ResamplerProcessor);
`;

const script = new Blob([ResamplerProcessorWorklet], {
  type: 'application/javascript',
});
const src = URL.createObjectURL(script);
export const ResamplerProcessorSrc = src;