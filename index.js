var mic = require('mic');
var fs = require('fs');
const {Transform} = require('stream');
var Fili = require('fili')
var iirCalculator = new Fili.CalcCascades();
 
// Build a high pass filter to attenuate electrical ground noise
var bstopFilterCoefs = iirCalculator.highpass({
    order: 3, // cascade 3 biquad filters (max: 12)
    characteristic: 'butterworth',
    Fs: 22050, // sampling frequency
    Fc: 150, // cutoff frequency / center frequency for bandpass, bandstop, peak
    BW: 1, // bandwidth only for bandstop and bandpass filters - optional
    gain: 0, // gain for peak, lowshelf and highshelf
    preGain: false // adds one constant multiplication for highpass and lowpass
})

var bStopFilter = new Fili.IirFilter(bstopFilterCoefs);

// Setup the mic instance data
var micInstance = mic({
    rate: '22050',
    channels: '1',
    debug: true,
    device: 'pcm.mixin'
});

var micInputStream = micInstance.getAudioStream();

var outputFileStream = fs.WriteStream('output.raw');
 
const debugRecordAudio = false;
if(debugRecordAudio) {
  // A filter transform if we're debugging audio
  const filterTransform = new Transform({
    transform: (data, encoding, done) => {
      if(data.length == 44) {
        return done(null, data)
      }
      var audioData = new Int16Array(data.buffer);
      const result = new Int16Array(bStopFilter.multiStep(audioData))
      const retBuf = Buffer.from(result.buffer)
      done(null, retBuf);
    }
  })

  micInputStream
  .pipe(filterTransform)
  .pipe(outputFileStream);
}

var processAudio = true;

const threshold = 0.05;
const movAvgLag = 20;
const mSecToWaitBeforeNextTrigger = 10 * 1000;
let lastTriggerMsec = new Date().getTime() - mSecToWaitBeforeNextTrigger;
console.log(lastTriggerMsec)
let currentMovingAvg = 0;
let numBlocksAboveThresh = 0;
let numBlocksBeforeTrigger = 5;

 
micInputStream.on('data', function(data) {
    // console.log("Recieved Input Stream: " + data.length);
    if(data.length < 1024) {
      return;
    }
    if(!processAudio) {
      return;
    }
    var audioData = new Int16Array(data.buffer);
    // Filter the 50hz buzz
    var filteredAudio = new Int16Array(bStopFilter.multiStep(audioData))

    let maxVal = 0;
    for(var i = 0; i < filteredAudio.length; ++i) {
      maxVal = Math.max(Math.abs(filteredAudio[i]), maxVal);
    }

    // Normalise to 0-1
    maxVal = maxVal / 32768;

    // Update the moving average
    currentMovingAvg = movAvg(currentMovingAvg, maxVal, movAvgLag);

    console.log("Current max average: " + currentMovingAvg);

    if(currentMovingAvg > threshold) {
      numBlocksAboveThresh++;
    }
    else {
      numBlocksAboveThresh = 0;
    }

    if(numBlocksAboveThresh == numBlocksBeforeTrigger) {
      // And don't trigger for at least some time since the last one
      const timeNow = new Date().getTime();
      const msecSinceLastTrigger = timeNow - lastTriggerMsec;
      if(msecSinceLastTrigger > mSecToWaitBeforeNextTrigger) {
        lastTriggerMsec = timeNow;
        console.log("Trigger!");
      }
      // Always reset the count
      numBlocksAboveThresh = 0;
    }

});

var movAvg = function (oldVale, newValue, lag) {
  return ((oldVale * lag) + newValue)/(lag + 1)
}
 
micInputStream.on('error', function(err) {
    cosole.log("Error in Input Stream: " + err);
});
 
micInputStream.on('startComplete', function() {
    console.log("Got SIGNAL startComplete");
    // setTimeout(function() {
    //         micInstance.pause();
    // }, 5000);
});
    
micInputStream.on('stopComplete', function() {
    console.log("Got SIGNAL stopComplete");
});
    
micInputStream.on('pauseComplete', function() {
    console.log("Got SIGNAL pauseComplete");
    setTimeout(function() {
        micInstance.resume();
    }, 5000);
});
 
micInputStream.on('resumeComplete', function() {
    console.log("Got SIGNAL resumeComplete");
    setTimeout(function() {
        micInstance.stop();
    }, 5000);
});
 
micInputStream.on('silence', function() {
    console.log("Got SIGNAL silence");
});
 
micInputStream.on('processExitComplete', function() {
    console.log("Got SIGNAL processExitComplete");
});
 
micInstance.start();
