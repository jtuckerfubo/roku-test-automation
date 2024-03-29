sub init()
	m.requestHeaderSize = 8 ' 4 byte string payload length and 4 byte binary payload length
	m.port = createObject("roMessagePort")
	m.top.observeFieldScoped("renderThreadResponse", m.port)
	m.top.functionName = "runTaskThread"
	m.top.control = "RUN"
end sub

sub setValidRequestTypes()
	m.validTaskRequestTypes = {
		"readRegistry": {
			"handler": processReadRegistryRequest
		}
		"writeRegistry": {
			"handler": processWriteRegistryRequest
		}
		"deleteRegistrySections": {
			"handler": processDeleteRegistrySectionsRequest
		}
		"getVolumeList": {
			"handler": processGetVolumeListRequest
		}
		"getDirectoryListing": {
			"handler": processGetDirectoryListingRequest
		}
		"statPath": {
			"handler": processStatPathRequest
		}
		"createDirectory": {
			"handler": processCreateDirectoryRequest
		}
		"deleteFile": {
			"handler": processDeleteFileRequest
		}
		"renameFile": {
			"handler": processRenameFileRequest
		}
		"readFile": {
			"handler": processReadFileRequest
		}
		"writeFile": {
			"handler": processWriteFileRequest
		}
		"getApplicationStartTime": {
			"handler": processGetApplicationStartTimeRequest
		}
		"getServerHost": {
			"handler": processGetServerHostRequest
		}
	}
end sub

sub runTaskThread()
	setValidRequestTypes()

	address = createObject("roSocketAddress")
	address.setPort(9000)

	m.listenSocket = createObject("roStreamSocket")
	m.listenSocketId = m.listenSocket.getID().toStr()
	m.listenSocket.setMessagePort(m.port)
	m.listenSocket.setAddress(address)
	m.listenSocket.notifyReadable(true)
	m.listenSocket.listen(4)
	m.clientSockets = {}
	m.socketsWithQueuedData = []

	m.receivingRequests = {}
	m.activeRequests = {}

	while true
		if m.socketsWithQueuedData.count() > 0 then
			waitDelay = 1
			socketWithQueuedData = m.socketsWithQueuedData.shift()
			handleClientSocketEvent(socketWithQueuedData.messageSocketId, socketWithQueuedData.clientSocket, socketWithQueuedData.bufferLength)
		else
			waitDelay = 1000
		end if

		' If you want to waste three days debugging set this back to 0 :|
		message = wait(waitDelay, m.port)
		if message <> Invalid then
			messageType = type(message)
			if messageType = "roSocketEvent" then
				handleSocketEvent(message)
			else if messageType = "roSGNodeEvent" then
				handleNodeEvent(message)
			else
				RTA_logWarn(messageType + " type not handled")
			end if
		end if
	end while
end sub

sub handleSocketEvent(message as Object)
	messageSocketId = message.getSocketID().toStr()

	' If the socketId matches our listen socketId this is a new connection being established
	if messageSocketId = m.listenSocketId then
		if m.listenSocket.isReadable() then
			clientSocket = m.listenSocket.accept()
			if clientSocket = Invalid then
				RTA_logError("Connection accept failed")
			else
				' We setup notification for when the new connection is readable
				clientSocket.notifyReadable(true)
				m.clientSockets[clientSocket.getID().toStr()] = clientSocket
			end if
		end if
	else
		clientSocket = m.clientSockets[messageSocketId]
		bufferLength = clientSocket.getCountRcvBuf()
		if bufferLength > 0 then
			handleClientSocketEvent(messageSocketId, clientSocket, bufferLength)
		else
			RTA_logInfo("Client closed connection")
			clientSocket.close()
			m.clientSockets.delete(messageSocketId)
		end if
	end if
end sub

sub handleClientSocketEvent(messageSocketId as String, clientSocket as Object, bufferLength as Integer)
	receivingRequest = m.receivingRequests[messageSocketId]
	if receivingRequest = invalid then
		ba = createObject("roByteArray")
		ba[m.requestHeaderSize - 1] = 0

		' Read our request header to know how big our request is
		clientSocket.receive(ba, 0, m.requestHeaderSize)
		bufferLength -= m.requestHeaderSize
		receivingRequest = {
			"stringLength": unpackInt32LE(ba, 0)
			"binaryLength": unpackInt32LE(ba, 4)
			"stringPayload": ""
			"binaryPayload": createObject("roByteArray")
			"socket": clientSocket
		}
		m.receivingRequests[messageSocketId] = receivingRequest
	end if

	if bufferLength > 0 then
		remainingBufferLength = receiveDataForRequest(receivingRequest, bufferLength)
		if remainingBufferLength >= 0 then
			' We've received the whole request so handle it now
			m.receivingRequests.delete(messageSocketId)
			verifyAndHandleRequest(receivingRequest)

			' If we still have more data queued then store it so we can pick it up after we handle sending back any requests that are ready to be sent back
			if remainingBufferLength > 0 then
				m.socketsWithQueuedData.push({
					"messageSocketId": messageSocketId
					"clientSocket": clientSocket
					"bufferLength": remainingBufferLength
				})
			end if
		end if
	end if
end sub

sub handleNodeEvent(message)
	fieldName = message.getField()
	if message.getField() = "renderThreadResponse" then
		response = message.getData()
		request = m.activeRequests[response.id]
		m.activeRequests.delete(response.id)
		sendResponseToClient(request, response)
	else
		RTA_logWarn(fieldName + " not handled")
	end if
end sub

' Returns number of bytes remaining in buffer if request was fully received or -1 if more data still needs to be received
function receiveDataForRequest(request as Object, bufferLength as Integer) as Integer
	socket = request.socket
	' Check if we are going to receive binary or string data
	if request.stringPayload.len() = request.stringLength then
		' We've already received entire string payload so the rest is either the binary payload or the next request
		binaryLength = request.binaryLength
		if bufferLength > 0 then
			if binaryLength > 0 then
				if bufferLength > binaryLength then
					receiveLength = binaryLength
				else
					receiveLength = bufferLength
				end if

				ba = createObject("roByteArray")
				ba[bufferLength - 1] = 0
				socket.receive(ba, 0, bufferLength)
				request.binaryPayload.append(ba)
				bufferLength -= receiveLength
			end if
		end if

		if binaryLength = request.binaryPayload.count() then
			return bufferLength
		end if
	else
		if bufferLength > 0 then
			' Figure out amount to pull from the buffer for string
			if bufferLength > request.stringLength then
				receiveLength = request.stringLength
			else
				receiveLength = bufferLength
			end if

			request.stringPayload += socket.receiveStr(receiveLength)
			bufferLength -= receiveLength
			return receiveDataForRequest(request, bufferLength)
		end if
	end if

	return -1
end function


sub verifyAndHandleRequest(request)
	json = parseJson(request.stringPayload)
	if NOT RTA_isAA(json) then
		RTA_logError("Received message did not contain valid request " + request.stringPayload)
		return
	end if
	request.json = json

	requestId = json.id
	if NOT RTA_isNonEmptyString(requestId) then
		RTA_logError("Received message did not have id " + request.stringPayload)
		return
	end if

	requestType = RTA_getStringAtKeyPath(json, "type")

	requestArgs = json.args
	if NOT RTA_isAA(requestArgs) then
		sendBackError(json, "No args supplied for request type '" + requestType + "'")
		return
	end if

	if requestType = "setSettings" then
		setLogLevel(RTA_getStringAtKeyPath(requestArgs, "logLevel"))
	end if

	if m.activeRequests[requestId] <> Invalid then
		RTA_logError("Ignoring request id " + requestId + ". Already received and running")
		return
	end if

	requestTypeConfig = m.validTaskRequestTypes[requestType]
	if requestTypeConfig <> Invalid then
		' If there is a handler, this request type is handled on the task thread
		handler = requestTypeConfig.handler
		if RTA_isFunction(handler) then
			request.timespan = createObject("roTimespan")
			handler(request)
			return
		end if
	end if

	m.activeRequests[requestId] = request
	m.top.renderThreadRequest = json
end sub

sub processReadRegistryRequest(request as Object)
	args = request.json.args
	values = args.values
	if NOT RTA_isAA(values) OR values.isEmpty() then
		sections = createObject("roRegistry").getSectionList()
		values = {}
		for each section in sections
			values[section] = {}
		end for
	end if

	outputValues = {}
	for each section in values
		sec = createObject("roRegistrySection", section)
		if sec = Invalid then
			sendBackError(request, "Could not create registry section '" + section + "'")
			return
		end if
		sectionRequestedValues = values[section]

		if RTA_isString(sectionRequestedValues) then
			sectionRequestedValues = [sectionRequestedValues]
		else if NOT RTA_isArray(sectionRequestedValues) OR sectionRequestedValues.isEmpty() then
			sectionRequestedValues = sec.getKeyList()
		end if
		outputValues[section] = sec.readMulti(sectionRequestedValues)
	end for

	sendResponseToClient(request, {
		"values": outputValues
	})
end sub

sub processWriteRegistryRequest(request as Object)
	args = request.json.args
	values = args.values
	for each section in values
		sec = createObject("roRegistrySection", section)
		if sec = Invalid then
			sendBackError(request, "Could not create registry section '" + section + "'")
			return
		end if

		' Have to clear out null values or it will cause the write to fail
		sectionItemKeys = values[section]
		for each key in sectionItemKeys
			if sectionItemKeys[key] = Invalid then
				sec.delete(key)
				sectionItemKeys.delete(key)
			end if
		end for

		sectionValues = values[section]

		if NOT sectionValues.isEmpty() AND NOT sec.writeMulti(sectionValues) then
			sendBackError(request, "Could not write values for registry section '" + section + "'")
			return
		end if
	end for

	if NOT createObject("roRegistry").flush() then
		sendBackError(request, "Failed flushing registry")
		return
	end if

	sendResponseToClient(request, {})
end sub

sub processDeleteRegistrySectionsRequest(request as Object)
	args = request.json.args
	registry = createObject("roRegistry")

	sections = args.sections
	if RTA_isString(sections) then
		sections = [sections]
	end if

	if sections.isEmpty() then
		if args.allowEntireRegistryDelete then
			sections = registry.getSectionList()
		else
			sendBackError(request, "Delete request did not pass in any sections")
		end if
	end if

	for each section in sections
		if NOT registry.delete(section) then
			sendBackError(request, "Failed deleting registry section '" + section + "'")
			return
		end if
	end for

	if NOT registry.flush() then
		sendBackError(request, "Failed flushing registry")
		return
	end if

	sendResponseToClient(request, {})
end sub

sub processGetVolumeListRequest(request as Object)
	sendResponseToClient(request, {
		"list": createObject("roFileSystem").getVolumeList().toArray()
	})
end sub

sub processGetDirectoryListingRequest(request as Object)
	args = request.json.args
	path = RTA_getStringAtKeyPath(args, "path")
	sendResponseToClient(request, {
		"list": createObject("roFileSystem").getDirectoryListing(path).toArray()
	})
end sub

sub processStatPathRequest(request as Object)
	args = request.json.args
	path = RTA_getStringAtKeyPath(args, "path")
	fs = createObject("roFileSystem")
	if NOT fs.exists(path) then
		sendBackError(request, "No file or directory exists at path: '" + path + "'")
	else
		fileInfo = fs.stat(path)
		' Have to convert the roDateTime to be able to json encode
		fileInfo.ctime = fileInfo.ctime.asSeconds()
		fileInfo.mtime = fileInfo.mtime.asSeconds()
		sendResponseToClient(request, fileInfo)
	end if
end sub

sub processCreateDirectoryRequest(request as Object)
	args = request.json.args
	path = RTA_getStringAtKeyPath(args, "path")
	if createObject("roFileSystem").createDirectory(path) then
		sendResponseToClient(request, {})
	else
		sendBackError(request, "Failed to create directory path: '" + path + "'")
	end if
end sub

sub processDeleteFileRequest(request as Object)
	args = request.json.args
	path = RTA_getStringAtKeyPath(args, "path")

	path = RTA_getStringAtKeyPath(args, "path")
	if createObject("roFileSystem").delete(path) then
		sendResponseToClient(request, {})
	else
		sendBackError(request, "Failed to delete path: '" + path + "'")
	end if
end sub

sub processRenameFileRequest(request as Object)
	args = request.json.args
	fromPath = RTA_getStringAtKeyPath(args, "fromPath")
	toPath = RTA_getStringAtKeyPath(args, "toPath")
	if createObject("roFileSystem").rename(fromPath, toPath) then
		sendResponseToClient(request, {})
	else
		sendBackError(request, "Failed renaming fromPath: '" + fromPath + "' toPath: '" + toPath + "'")
	end if
end sub

sub processReadFileRequest(request as Object)
	args = request.json.args
	path = RTA_getStringAtKeyPath(args, "path")
	ba = createObject("roByteArray")
	if ba.readFile(path) then
		sendResponseToClient(request, {}, ba)
	else
		sendBackError(request, "Failed reading file path: '" + path + "'")
	end if
end sub

sub processWriteFileRequest(request as Object)
	args = request.json.args
	path = RTA_getStringAtKeyPath(args, "path")
	if request.binaryPayload.writeFile(path) then
		sendResponseToClient(request, {})
	else
		sendBackError(request, "Failed writing file path: '" + path + "'")
	end if
end sub

sub processGetApplicationStartTimeRequest(request as Object)
	if m.appManager = Invalid then
		m.appManager = createObject("roAppManager")
	end if

	date = createObject("roDateTime")
	currentTime& = date.asSeconds()
	currentTime& = currentTime& * 1000 + date.getMilliseconds()
	startTimeDifference = m.appManager.getUptime().totalMilliseconds()
	startTime = currentTime& - startTimeDifference

	sendResponseToClient(request, {
		"startTime": startTime
	})
end sub

sub processGetServerHostRequest(request as Object)
	sendResponseToClient(request, {
		"host": request.socket.getReceivedFromAddress().getHostName()
	})
end sub

sub sendBackError(request as Object, message as String)
	RTA_logError(message)
	sendResponseToClient(request, RTA_buildErrorResponseObject(message))
end sub

sub sendResponseToClient(request as Object, response as Object, binaryPayloadByteArray = Invalid as Dynamic)
	if NOT RTA_isBoolean(response.success) then
		response.success = true
	end if

	if request.timespan <> Invalid then
		response["timeTaken"] = request.timespan.totalMilliseconds()
		request.delete("timeTaken")
	end if

	json = request.json
	if response.id = Invalid then
		response.id = json.id
	end if

	stringPayload = formatJson(response)
	if stringPayload.len() < 1024 then
		RTA_logDebug("Sending back response for requestType: " + json.type, stringPayload)
	else
		RTA_logDebug("Sending back large response (id: " + json.id + ", requestType: " + json.type + ", success: " + response.success.toStr() + ", timeTaken: " + response.timeTaken.toStr() + ")")
	end if

	ba = createObject("roByteArray")
	ba[m.requestHeaderSize - 1] = 0
	packInt32LE(ba, 0, stringPayload.len())

	stringPayloadByteArray = createObject("roByteArray")
	stringPayloadByteArray.fromAsciiString(stringPayload)

	' In the same way we combine our buffers on the node side we're combining our byte arrays here to avoid potential added latency
	ba.append(stringPayloadByteArray)

	if binaryPayloadByteArray <> Invalid then
		packInt32LE(ba, 4, binaryPayloadByteArray.count())
		ba.append(binaryPayloadByteArray)
	end if

	socket = request.socket
	bytesRemaining = ba.count()
	currentIndex = 0
	maxSegmentSize = socket.getMaxSeg()
	while bytesRemaining > 0
		bytesSent = socket.send(ba, currentIndex, bytesRemaining)
		if bytesSent > 0 then
			bytesRemaining -= bytesSent
			currentIndex += bytesSent
		end if

		while socket.getCountSendBuf() > maxSegmentSize
			sleep(1)
		end while
	end while
end sub

function unpackInt32LE(ba as Object, offset as Integer) as Integer
	value = ba[offset]
	value += ba[offset + 1] << 8
	value += ba[offset + 2] << 16
	value += ba[offset + 3] << 24
	return value
end function

sub packInt32LE(ba as Object, offset as Integer, value as Integer)
	ba[offset] = value AND 255
	ba[offset + 1] = value >> 8 AND 255
	ba[offset + 2] = value >> 16 AND 255
	ba[offset + 3] = value >> 24 AND 255
end sub
