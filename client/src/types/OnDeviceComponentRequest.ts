export namespace ODC {
	export enum RequestEnum {
		callFunc,
		createDirectory,
		deleteFile,
		deleteNodeReferences,
		deleteRegistrySections,
		disableScreenSaver,
		focusNode,
		getDirectoryListing,
		getFocusedNode,
		getNodesInfo,
		getNodesWithProperties,
		getServerHost,
		getValue,
		getValues,
		getVolumeList,
		handshake,
		hasFocus,
		isInFocusChain,
		observeField,
		readFile,
		readRegistry,
		renameFile,
		setValue,
		statPath,
		storeNodeReferences,
		writeFile,
		writeRegistry,
	}
	export type RequestTypes = keyof typeof RequestEnum;

	export enum BaseEnum {
		global,
		scene,
		nodeRef,
		focusedNode
	}
	export type BaseTypes = keyof typeof BaseEnum;

	export declare type LogLevels = 'off' | 'error' | 'warn' | 'info' | 'debug' | 'verbose';

	export interface BaseArgs {
		/** Specifies what the entry point is for this key path. Defaults to 'global' if not specified */
		base?: BaseTypes;

		/** If base is 'nodeRef' this is the key that we used to store the node references on. If one isn't provided we use the automatically generated one */
		key?: string;
	}

	export interface BaseKeyPath extends BaseArgs, MaxChildDepth {
		/** Holds the hierarchy value with each level separated by dot for ex: videoNode.title to what you are interested in getting the value from or written to. */
		keyPath: string;

		/** We have to convert nodes before converting to json. If this isn't needed then it causes a fairly significant overhead */
		convertResponseToJsonCompatible?: boolean;
	}

	interface MaxChildDepth {
		/** Controls how deep we'll recurse into node's tree structure. Defaults to 0 */
		responseMaxChildDepth?: number;
	}

	export interface CallFuncArgs extends BaseKeyPath {
		/** Name of the function that needs to be called. */
		funcName: string;

		/** List of input arguments that need to be passed to the function. */
		funcParams?: any[];
	}

	export interface GetFocusedNodeArgs extends MaxChildDepth {
		/** returns `ref` field in response that can be matched up with storeNodeReferences response for determining where we are in the node tree */
		includeRef?: boolean;

		/** Key that the references were stored on. If one isn't provided we use the automatically generated one */
		key?: string;

		/** If true, will try to return the actual ArrayGrid itemComponent that is currently focused */
		returnFocusedArrayGridChild?: boolean;
	}

	export interface GetValueArgs extends BaseKeyPath {}

	export interface GetValuesArgs {
		/** Retrieve multiple values with a single request. A list of the individual getValue args */
		requests: {
			[key: string]: GetValueArgs;
		};
	}

	export interface GetNodesInfoArgs extends GetValuesArgs {}

	export interface HasFocusArgs extends BaseKeyPath {}

	export interface IsInFocusChainArgs extends BaseKeyPath {}

	export interface StoreNodeReferencesArgs {
		/** Key that we will store the node references on. If one isn't provided we use the automatically generated one */
		key?: string;

		/** We can get ArrayGrid(RowList,MarkupGrid,etc) children but this has an extra overhead so is disabled by default */
		includeArrayGridChildren?: boolean;

		/** We can get total and type based count info but again this has some overhead so is disabled by default */
		includeNodeCountInfo?: boolean;
	}

	export interface DeleteNodeReferencesArgs {
		/** Key that the references were stored on. If one isn't provided we use the automatically generated one */
		key?: string;
	}

	export interface DisableScreensaverArgs {
		/** Set to true to disable screensaver from starting, false to allow screensaver to start at the appropriate time */
		disableScreensaver?: boolean;
	}

	export interface FocusNodeArgs extends BaseKeyPath {
		/** Set to false to take away focus from the node. Defaults to true */
		on?: boolean;
	}

	export interface GetVolumeListArgs {}

	export interface Path {
		path: string;
	}

	export interface GetDirectoryListingArgs extends Path {}

	export interface StatPathArgs extends Path {}

	export interface CreateDirectoryArgs extends Path {}

	export interface DeleteFileArgs extends Path {}

	export interface RenameFileArgs {
		fromPath: string;
		toPath: string;
	}

	export interface ReadFileArgs extends Path {}

	export interface WriteFileArgs extends Path {
		binaryPayload: Buffer
	}

	// IMPROVEMENT build out to support more complicated types
	type ComparableValueTypes = string | number | boolean;

	export type ComparisonOperators = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | '!in' | 'equal' | 'notEqual' | 'greaterThan' | 'greaterThanEqualTo' | 'lessThan' | 'lessThanEqualTo';

	interface NodeComparison {
		/* defaults to equal if not provided */
		operator?: ComparisonOperators;

		/* field acts a shorthand to specify fields. */
		field?: string;

		/* only fields will be used if both fields and keyPaths are provided */
		fields?: string[];

		/* keyPath acts a shorthand to specify keyPaths */
		keyPath?: string;

		/* only fields will be used if both fields and keyPaths are provided */
		keyPaths?: string[];

		value: ComparableValueTypes;
	}

	export interface GetNodesWithPropertiesArgs extends MaxChildDepth {
		/** This is the key that we used to store the node references on. If one isn't provided we use the automatically generated one */
		key?: string;
		properties: NodeComparison[];
	}

	interface MatchObject extends BaseKeyPath {
		/** If the match value is passed in then the observer will be fired when the field value equals to the value in match */
		value: ComparableValueTypes;
	}

	export interface ObserveFieldArgs extends BaseKeyPath {
		/** If the `keyPath` does not exist yet, this specifies how often to recheck to see if it now exists in milliseconds */
		retryInterval?: number;

		/** If the `keyPath` does not exist yet, this specifies how long to wait before erroring out in milliseconds */
		retryTimeout?: number;

		/** If provided will only return when this matches (including if it already equals that value) */
		match?: MatchObject | ComparableValueTypes;
	}

	export interface SetValueArgs extends BaseKeyPath {
		/** Value that needs to be set to the field. Field path is defined by key path. */
		value: any;

		/** Used to specify whether we are setting a field on a node or if we're updating the node structure itself. If not defined, we take the last part of the keyPath and use it as the field */
		field?: string;
	}

	export interface ReadRegistryArgs {
		/** List of Section keys of which we need data to be read, if empty then it will return entire contents of the registry */
		values?: {
			[section: string]: string[] | string;
		};
	}

	export interface WriteRegistryArgs {
		/** Contains data that will be written to registry. If null is passed for a sectionItemKey that key will be deleted. If null is passed for a section that entire section will be deleted. */
		values: {
			[section: string]: {[sectionItemKey: string]: string | null}
		};
	}

	export interface DeleteRegistrySectionsArgs {
		/** Contains list of section keys that needs to be deleted. */
		sections: string[] | string;

		/** If true deletes the entry registry. */
		allowEntireRegistryDelete?: boolean;
	}

	export interface DeleteEntireRegistrySectionsArgs {}

	export interface GetServerHostArgs {}

	export type RequestArgs = CallFuncArgs | GetFocusedNodeArgs | GetValueArgs | GetValuesArgs | HasFocusArgs | IsInFocusChainArgs | ObserveFieldArgs | SetValueArgs | ReadRegistryArgs | WriteRegistryArgs | DeleteRegistrySectionsArgs | DeleteEntireRegistrySectionsArgs | StoreNodeReferencesArgs | GetNodesInfoArgs;

	export interface RequestOptions {
		/** How long to wait (in milliseconds) until the request is considered a failure. If not provided OnDeviceComponent.defaultTimeout is used  */
		timeout?: number;
	}

	export interface Request {
		id: string;
		args: RequestArgs;
		type: RequestTypes;
		settings: {
			logLevel: LogLevels
		};
		callback?: (response: ODC.RequestResponse) => void;
	}

	export interface RequestResponse {
		json: any;
		stringLength: number;
		binaryLength: number;
		stringPayload: string;
		binaryPayload: Buffer;
	}

	export interface NodeRepresentation {
		// Allow other fields
		[key: string]: any;
		change: {
			Index1: number;
			Index2: number;
			Operation: string;
		};
		childRenderOrder?: 'renderFirst' | 'renderLast';
		children: NodeRepresentation[];
		clippingRect?: [number, number, number, number];
		enableRenderTracking?: boolean;
		focusedChild: NodeRepresentation;
		focusable: boolean;
		id: string;
		inheritParentOpacity?: boolean;
		inheritParentTransform?: boolean;
		muteAudioGuide?: boolean;
		opacity?: number;
		renderPass?: number;
		renderTracking?: 'none' | 'partial' | 'full';
		rotation?: number;
		scale?: [number, number];
		scaleRotateCenter?: [number, number];
		subtype: string;
		translation?: [number, number];
		visible?: boolean;
	}

	export interface NodeTree {
		id: string;

		/** What type of node this as returned by node.subtype() */
		subtype: string;

		/** This is the reference to the index it was stored at that we can use in later calls. If -1 we don't have one. */
		ref: number;

		/** Same as ref but for the parent  */
		parentRef: number;

		/** Used to determine the position of this node in its parent if applicable */
		position: number;

		children: NodeTree[];
	}

	export interface ReturnTimeTaken {
		/** How this request took to run on the device */
		timeTaken: number;
	}
}
