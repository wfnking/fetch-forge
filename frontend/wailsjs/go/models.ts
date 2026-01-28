export namespace main {
	
	export class Profile {
	    id: string;
	    name: string;
	    args: string[];
	
	    static createFrom(source: any = {}) {
	        return new Profile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.args = source["args"];
	    }
	}
	export class Task {
	    id: string;
	    url: string;
	    title: string;
	    sourceHost: string;
	    status: string;
	    stage: string;
	    progress: string;
	    outputPath: string;
	    missingOutput: boolean;
	    errorMessage: string;
	    resume: boolean;
	    duration: number;
	    filesize: number;
	    width: number;
	    height: number;
	    // Go type: time
	    createdAt: any;
	    // Go type: time
	    updatedAt: any;
	
	    static createFrom(source: any = {}) {
	        return new Task(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.url = source["url"];
	        this.title = source["title"];
	        this.sourceHost = source["sourceHost"];
	        this.status = source["status"];
	        this.stage = source["stage"];
	        this.progress = source["progress"];
	        this.outputPath = source["outputPath"];
	        this.missingOutput = source["missingOutput"];
	        this.errorMessage = source["errorMessage"];
	        this.resume = source["resume"];
	        this.duration = source["duration"];
	        this.filesize = source["filesize"];
	        this.width = source["width"];
	        this.height = source["height"];
	        this.createdAt = this.convertValues(source["createdAt"], null);
	        this.updatedAt = this.convertValues(source["updatedAt"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

