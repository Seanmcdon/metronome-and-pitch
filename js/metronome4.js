var audioContext = null;
var isPlaying = false;      // Are we currently playing?

var current16thNote;        // What note is currently last scheduled?
var tempo = 120.0;          // tempo (in beats per minute)

var lookahead = 25.0;       // How frequently to call scheduling function (in milliseconds)
var scheduleAheadTime = 0.1;    // How far ahead to schedule audio (sec)
                            // This is calculated from lookahead, and overlaps 
                            // with next interval (in case the timer is late)
var nextNoteTime = 0.0;     // when the next note is due.
var noteResolution = 0;     // 0 == 16th, 1 == 8th, 2 == quarter note
var noteLength = 0.05;      // length of "beep" (in seconds)
var canvas,                 // the canvas element
    canvasContext;          // canvasContext is the canvas' context 2D
var last16thNoteDrawn = -1; // the last "box" we drew on the screen
var notesInQueue = [];      // the notes that have been put into the web audio,
                            // and may or may not have played yet. {note, time}
var timerWorker = null;     // The Web Worker used to fire timer messages

var tapOccurred = false;    // used when a sound occurs that is far enough away from last sound (good sound)
var taps = [];              // when there is a tap to display

var source,                 // webAudio, used in function initializeStream(stream) 
    analyser, 
				bufferLength, 
				dataArray,
				pitchDataArray;

//these are some DOM elements initialized here 																	
var container = document.createElement( 'div' );
				container.className = "container";
				canvas = document.createElement( 'canvas' );
				canvasContext = canvas.getContext( '2d' );
				canvasContext.strokeStyle = "#ffffff";
				canvasContext.lineWidth = 2;
				canvas.height = 100;									

var firstFrameTime = 0.0;
var lastSoundTime = 0.0;				
				
//ID for the animationFrames
var rafID = null;
				
//IN DEVELOPMENT*********** 					
//need this to keep track of where we are
var last16thNote = 0;

//PITCH DETECTOR JS

//some DOM elements
	var detectorElem, 
		waveCanvas,
		pitchElem,
		noteElem,
		detuneElem,
		detuneAmount;
	
//pitchdetector 
var noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

//used in algorithms
var MIN_SAMPLES = 0;  // will be initialized when AudioContext is created.
var GOOD_ENOUGH_CORRELATION = 0.9; // this is the "bar" for how close a correlation needs to be

//END PITCH DETECTOR JS
																																		
function nextNote() {
    // Advance current note and time by a 16th note...
    var secondsPerBeat = 60.0 / tempo;    // Notice this picks up the CURRENT 
                                          // tempo value to calculate beat length.
    nextNoteTime += 0.25 * secondsPerBeat;    // Add beat length to last beat time

    current16thNote++;    // Advance the beat number, wrap to zero
    if (current16thNote == 16) {
				    //give a litte time for a clap on the last beat before we go back
        //var t = setTimeOut(function(){ current16thNote = 0; }, secondsPerBeat/3);
        current16thNote = 0;
				}
}

function scheduleNote( beatNumber, time, tap ) {
    // push the note on the queue, even if we're not playing.
				
				notesInQueue.push( { note: beatNumber, time: time, sound: tap } );
    //notesInQueue.push( { note: beatNumber, time: time } );
				
				//below this is for playing audio on the eighth notes
    
    if ( (noteResolution==1) && (beatNumber%2))
        return; // we're not playing non-8th 16th notes
    if ( (noteResolution==2) && (beatNumber%4))
        return; // we're not playing non-quarter 8th notes

    // create an oscillator
				
				
				
				
    var osc = audioContext.createOscillator();
    osc.connect( audioContext.destination );
    if (beatNumber % 16 === 0)    // beat 0 == high pitch
        osc.frequency.value = 400.0;
    else if (beatNumber % 4 === 0 )    // quarter notes = medium pitch
        osc.frequency.value = 440.0;
    else                        // other 16th notes = low pitch
        osc.frequency.value = 500.0;

    //osc.start( time );
    //osc.stop( time + noteLength );
				
				//get all beats, including 16ths
				var beatBlocks = document.getElementsByClassName("beat");
				
				//remove all animation classes (up, down, sixteenth
				if(beatBlocks.length>0)for(var i = 0; i < beatBlocks.length; i++) beatBlocks[i].classList.remove("down", "up", "sixteenth");
				
				//get the current beat "block"
				var beatBlock = document.getElementById("beat-"+(beatNumber+1));		
   
			//sixteenth notes
			 if(beatNumber%2 == 1)beatBlock.classList.add("sixteenth"); 

				//all eighths
			 if(beatNumber%2 == 0)beatBlock.classList.add("up"); 
				
				//downbeats
				if(beatNumber%4 == 0){ 
				    beatBlock.classList.add("down"); 
        beatBlock.classList.remove("up");				
				}				
}

function scheduler() {
    // while there are notes that will need to play before the next interval, 
    // schedule them and advance the pointer.
    while (nextNoteTime < audioContext.currentTime + scheduleAheadTime ) {
        scheduleNote( current16thNote, nextNoteTime, tapOccurred );
								tapOccurred = false;
        nextNote();
    }
}

function play() {
    isPlaying = !isPlaying;

    if (isPlaying) { // start playing
				    //this next line user to be 
								//current16thNote = 0;
        current16thNote = parseInt(current16thNote) ? current16thNote : 0;
				    //global function
				    rafID = requestAnimationFrame(moveItAndListen);	
    				timerWorker.postMessage("start");
        return "stop";
    } else {
        timerWorker.postMessage("stop");
								cancelAnimationFrame(rafID);
						
        return "play";
    }
}

function resetCanvas (e) {
    // resize the canvas - but remember - this clears the canvas too.
    canvas.width = window.innerWidth/2+3;
    beatContainer = document.querySelectorAll(".beat");		
								for (var i = 0; i < beatContainer.length; i++) {
												beatContainer[i].style.width = window.innerWidth/2/16+"px";
												beatContainer[i].style.height = 100+"px";				
								}
								
    //make sure we scroll to the top left.
    window.scrollTo(0,0); 
}

function getRandomInt(min, max) {
				min = Math.ceil(min);
				max = Math.floor(max);
				return Math.floor(Math.random() * (max - min)) + min; //The maximum is exclusive and the minimum is inclusive
}

function initializeStream(stream) {

				source = audioContext.createMediaStreamSource(stream);
				analyser = audioContext.createAnalyser();
				analyser.fftSize = 2048;
				bufferLength = analyser.frequencyBinCount;
				dataArray = new Uint8Array(bufferLength);
				source.connect(analyser);
								
    pitchDataArray = new Float32Array( 1024 );
			
			
}
				
function moveItAndListen(){				
				
				//PITCH DETECTOR HERE
				analyser.getFloatTimeDomainData( pitchDataArray ); 
				var ac = autoCorrelate();

				if (ac == -1) {
								detectorElem.className = "vague";
								pitchElem.innerText = "--";
								noteElem.innerText = "-";
								detuneElem.className = "";
								detuneAmount.innerText = "--";
				} 
				else {
								detectorElem.className = "confident";
								pitchElem.innerText = Math.round( ac ) ;
								noteElem.innerHTML = noteStrings[noteFromPitch( ac )%12];
								var detune = centsOffFromPitch( ac, noteFromPitch( ac ) );
								if (detune == 0 ) {
									detuneElem.className = "";
									detuneAmount.innerHTML = "--";
								} 
								else {
												if (detune < 0) detuneElem.className = "flat";
												else {
													detuneElem.className = "sharp";
												 detuneAmount.innerHTML = Math.abs( detune );
												}
								}
				}
				//END PITCH DETECTOR 
				
				var timestamp = audioContext.currentTime;
				
				//so the block will move on beat 1
				if((current16thNote == 1) && (!newLoop)){
					taps.length = 0;
					newLoop = true;
				}	
				
				//so the variable will reset after beat 1
				if(current16thNote != 1) newLoop = false;
				
				//so that we can measure from note to note
				if(current16thNote != last16thNote) firstFrameTime = timestamp;			
				
				//to get the distance to animate the note					
				var runtime = timestamp - firstFrameTime;
				var progress = runtime / (60/tempo/4);								
				progress = Math.min(progress, 1);
				
				//clear the canvas
				canvasContext.clearRect(0,0,canvas.width, canvas.height);	
				canvasContext.fillStyle = "white";
				
				//draw the barlines
				canvasContext.strokeStyle = "black";
				canvasContext.beginPath();
				for(var i = 0; i < 4 ; i++){
						canvasContext.moveTo(i * canvas.width/4, 3 * canvas.height/10);
						canvasContext.lineTo(i * canvas.width/4, 7 * canvas.height/10);
						canvasContext.stroke();		
				}
				
				//double bar line at end
				canvasContext.beginPath();
				canvasContext.lineWidth = 3;
				canvasContext.moveTo(4 * canvas.width/4-1, 3 * canvas.height/10);
				canvasContext.lineTo(4 * canvas.width/4-1, 7 * canvas.height/10);
				canvasContext.stroke();										  
				canvasContext.moveTo(4 * canvas.width/4-6, 3 * canvas.height/10);
				canvasContext.lineTo(4 * canvas.width/4-6, 7 * canvas.height/10);
				canvasContext.stroke();	
				canvasContext.lineWidth = 1;
				
				//draw staff
				for(var i = 3; i < 8 ; i++){
						canvasContext.moveTo(0, i * canvas.height/10);
						canvasContext.lineTo(canvas.width, i * canvas.height/10);
						canvasContext.stroke();		
				}				
				
				//draw the note																				
				canvasContext.fillStyle = "black";	

				//draw notehead (16th note space X progress through current 16th note + radius)
				canvasContext.beginPath();																
				canvasContext.arc(canvas.width/4/4*(current16thNote-1) + canvas.width/4/4 * progress + 8, 
				                  50, 8 , 0, 2* Math.PI );			
				canvasContext.stroke();
				canvasContext.fill();
				
				//draw stem
				canvasContext.beginPath();
				canvasContext.moveTo(canvas.width/4/4*(current16thNote-1) + canvas.width/4/4 * progress + 16, 50);
				canvasContext.lineTo(canvas.width/4/4*(current16thNote-1) + canvas.width/4/4 * progress + 16,	10);		
				canvasContext.stroke();		
			
				//get samples for audio								
				analyser.getByteFrequencyData(dataArray);
				
				//check for a sound... make sure there is a gap between sounds....
				for(var i = 0; i < bufferLength; i++) {
								barHeight = dataArray[i];
								if((barHeight > 175) && ((timestamp - lastSoundTime) > (60/tempo/4)) && (i != 0)
											&& ((timestamp - lastSoundTime) > .2)){	
												tapOccurred = true;
												taps.push(canvas.width/4/4*(current16thNote-1) + 8);
												lastSoundTime = timestamp;
								}							
				}
				
				//check notes and update as time passes!
				var currentNote = last16thNoteDrawn;								
				var currentTime = audioContext.currentTime;
				while (notesInQueue.length && notesInQueue[0].time < currentTime) {
								currentNote = notesInQueue[0].note;
								currentSound = notesInQueue[0].sound;
								notesInQueue.splice(0,1);   // remove note from queue
				}
				
				//display all sounds
				if(taps.length){								
								for(var i = 0; i < taps.length; i++){
												canvasContext.fillStyle = "black";			
												//context.arc(x,y,r,sAngle,eAngle,counterclockwise)	
												//notehead
												canvasContext.beginPath();																
												canvasContext.arc(taps[i], 50, 8 , 0, 2* Math.PI );			
												canvasContext.stroke();
												canvasContext.fill();
												
												//note stem
												canvasContext.beginPath();
												canvasContext.moveTo(taps[i] + 8, 50);
												canvasContext.lineTo(taps[i] + 8,	10);		
												canvasContext.stroke();																
								}
				}
				
				//global function
				rafID = requestAnimationFrame(moveItAndListen);				
				
				last16thNote = current16thNote;
				
				if(noteStrings[noteFromPitch( ac )%12])drawVexFlow(noteStrings[noteFromPitch( ac )%12]);
}	

function init(){
			 //PITCH DETECTOR STUFF NOW!!
					detectorElem = document.getElementById( "detector" );
					pitchElem = document.getElementById( "pitch" );
					noteElem = document.getElementById( "note" );
					detuneElem = document.getElementById( "detune" );
					detuneAmount = document.getElementById( "detune_amt" );
			 //END PITCH DETECTOR
			
			
			
			
				if (navigator.mediaDevices.getUserMedia) {
							console.log('mediaDevices.getUserMedia supported.');
							navigator.mediaDevices.getUserMedia (
										// constraints - only audio needed for this app
										{
													 "audio": {
											
															"mandatory": {
															
																			"googEchoCancellation": "false",
																			"googAutoGainControl": "false",
																			"googNoiseSuppression": "false",
																			"googHighpassFilter": "false"
																			
															},
															
															"optional": []
											}
										}).then(

										// Success callback
										function(stream){ 
												
												//prepare to use it, need to call a function here because we have to use stream
												initializeStream(stream);		
												
										}).catch(
										// Error callback
										function(err) {
													console.log('The following gUM error occured: ' + err);
										});
				} else {
							console.log('getUserMedia not supported on your browser!');
				}
				//end "get microphone going..."																							 
										
				//add elements (variables from the first section of this file) to the DOM 					
    document.getElementById("beatDivs").appendChild( container );
    container.appendChild(canvas); 
				
				//alter DOM elements now that window is ready
				canvas.width = window.innerWidth/2+3;
    canvas.style.marginLeft = "4px";				

				var beatContainer = document.querySelectorAll(".beat");		
								for (var i = 0; i < beatContainer.length; i++) {
												beatContainer[i].style.width = window.innerWidth/2/16+"px";
												//beatContainer[i].style.height = 100+"px";				
								}
				
				
				//this needs to happen here
				audioContext = new AudioContext();				

    //nice reset functions...
    window.onorientationchange = resetCanvas;
    window.onresize = resetCanvas;

				//include a js file, like a class
    timerWorker = new Worker("js/metronomeworker.js");

				//use the new file
    timerWorker.onmessage = function(e) {
        if (e.data == "tick") {
            // console.log("tick!");
            scheduler();
        }
        else
            console.log("message: " + e.data);
    };
				
    timerWorker.postMessage({"interval":lookahead});				
}

//call the above function to start everything off!
window.addEventListener("load", init );

//PITCH DETECTOR HERE!!

//only used by updatePitch for user data - DOM()
function noteFromPitch( frequency ) {
	var noteNum = 12 * (Math.log( frequency / 440 )/Math.log(2) );
	return Math.round( noteNum ) + 69;
}

//only used by centsOffFromPitch()
function frequencyFromNoteNumber( note ) {
	return 440 * Math.pow(2,(note-69)/12);
}

//only used by updatePitch for user data - DOM()
function centsOffFromPitch( frequency, note ) {
	return Math.floor( 1200 * Math.log( frequency / frequencyFromNoteNumber( note ))/Math.log(2) );
}

//THE algorithm, uses buf and audioContext globals
function autoCorrelate() {

 var sampleRate = audioContext.sampleRate;
	var SIZE = pitchDataArray.length;
	var MAX_SAMPLES = Math.floor(SIZE/2);
	var best_offset = -1;
	var best_correlation = 0;
	var rms = 0;
	var foundGoodCorrelation = false;
	var correlations = new Array(MAX_SAMPLES);

	for (var i=0;i<SIZE;i++) {
		var val = pitchDataArray[i];
		rms += val*val;
	}
	rms = Math.sqrt(rms/SIZE);
	if (rms<0.01) // not enough signal
		return -1;

	var lastCorrelation=1;
	for (var offset = MIN_SAMPLES; offset < MAX_SAMPLES; offset++) {
		var correlation = 0;

		for (var i=0; i<MAX_SAMPLES; i++) {
			correlation += Math.abs((pitchDataArray[i])-(pitchDataArray[i+offset]));
		}
		correlation = 1 - (correlation/MAX_SAMPLES);
		correlations[offset] = correlation; // store it, for the tweaking we need to do below.
		if ((correlation>GOOD_ENOUGH_CORRELATION) && (correlation > lastCorrelation)) {
			foundGoodCorrelation = true;
			if (correlation > best_correlation) {
				best_correlation = correlation;
				best_offset = offset;
			}
		} else if (foundGoodCorrelation) {
			// short-circuit - we found a good correlation, then a bad one, so we'd just be seeing copies from here.
			// Now we need to tweak the offset - by interpolating between the values to the left and right of the
			// best offset, and shifting it a bit.  This is complex, and HACKY in this code (happy to take PRs!) -
			// we need to do a curve fit on correlations[] around best_offset in order to better determine precise
			// (anti-aliased) offset.

			// we know best_offset >=1, 
			// since foundGoodCorrelation cannot go to true until the second pass (offset=1), and 
			// we can't drop into this clause until the following pass (else if).
			var shift = (correlations[best_offset+1] - correlations[best_offset-1])/correlations[best_offset];  
			return sampleRate/(best_offset+(8*shift));
		}
		lastCorrelation = correlation;
	}
	if (best_correlation > 0.01) {
		// console.log("f = " + sampleRate/best_offset + "Hz (rms: " + rms + " confidence: " + best_correlation + ")")
		return sampleRate/best_offset;
	}
	return -1;
//	var best_frequency = sampleRate/best_offset;
}

//THE animationFrame
function updatePitch() {

				analyser.getFloatTimeDomainData( pitchDataArray );
				var ac = autoCorrelate();

				if (ac == -1) {
								detectorElem.className = "vague";
								pitchElem.innerText = "--";
								noteElem.innerText = "-";
								detuneElem.className = "";
								detuneAmount.innerText = "--";
				} 
				else {
								detectorElem.className = "confident";
								pitchElem.innerText = Math.round( ac ) ;
								noteElem.innerHTML = noteStrings[noteFromPitch( ac )%12];
								var detune = centsOffFromPitch( ac, noteFromPitch( ac ) );
								if (detune == 0 ) {
									detuneElem.className = "";
									detuneAmount.innerHTML = "--";
								} 
								else {
												if (detune < 0) detuneElem.className = "flat";
												else {
													detuneElem.className = "sharp";
												 detuneAmount.innerHTML = Math.abs( detune );
												}
								}
				}
			//	rafID = window.requestAnimationFrame( updatePitch );
}

function drawVexFlow(n){

    console.log(n);

				//TEST VEXFLOW
				var vexCanvas = document.getElementById("vexCanvas");
					var renderer = new Vex.Flow.Renderer(vexCanvas,
							Vex.Flow.Renderer.Backends.CANVAS);

					renderer.resize(525,120);		
							
					var ctx = renderer.getContext();
					var stave = new Vex.Flow.Stave(10, 0, 500);
					stave.addClef("treble").setContext(ctx).draw();
					
					if(n.length == 2){
									// A quarter-note C#.. note how to add the extra chaining to produce the accidental
									//addAccidental({position in current keys array}, ... )
									var vexNote = new Vex.Flow.StaveNote({ keys: [ n[0] + "/4"], duration: "w" }).
																           addAccidental(0, new Vex.Flow.Accidental(n[1]));
						
					}					
					else var vexNote = new Vex.Flow.StaveNote({ keys: [ n + "/4"], duration: "w" })

					// Create the notes
					var notes = [ vexNote ];

					// Create a voice in 4/4
					var voice = new Vex.Flow.Voice({
							num_beats: 4,
							beat_value: 4,
							resolution: Vex.Flow.RESOLUTION
					});

					// Add notes to voice
					voice.addTickables(notes);

					// Format and justify the notes to 500 pixels
					var formatter = new Vex.Flow.Formatter().
							joinVoices([voice]).format([voice], 500);

					// Render voice
					voice.draw(ctx, stave);				
				//END TEST VEXFLOW

}


