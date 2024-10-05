const express = require('express');
const { Server } = require('socket.io');
const http = require('http');
const getUserDetailsFromToken = require('../helpers/getUserDetailsFromToken');
const UserModel = require('../models/UserModel');
const { ConversationModel, MessageModel } = require('../models/ConversationModel');
const getConversation = require('../helpers/getConversation');

const app = express();

/*** Socket connection setup */
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*', // Replace '*' with allowed domains in production
        credentials: true,
    },
});

/*** Server listening at http://localhost:8080/ */

// Online users set to track online users
const onlineUser = new Set();

io.on('connection', async (socket) => {
    console.log("User connected with socket ID: ", socket.id);

    try {
        // Retrieve the token from handshake authentication
        const token = socket.handshake.auth.token;
        
        // Get current user details from the token
        const user = await getUserDetailsFromToken(token);

        // Ensure the user and user._id exist before using them
        if (!user || !user._id) {
            console.log('Error: Unable to get user details from token.');
            socket.emit('error', 'Authentication failed');
            socket.disconnect();  // Disconnect the socket if authentication fails
            return;
        }

        // User successfully authenticated
        socket.join(user._id.toString());  // Join the room based on the user ID
        onlineUser.add(user._id.toString());  // Add the user to the online users set

        // Notify all clients about the current online users
        io.emit('onlineUser', Array.from(onlineUser));

        /*** Event: message-page */
        socket.on('message-page', async (userId) => {
            try {
                const userDetails = await UserModel.findById(userId).select("-password");

                const payload = {
                    _id: userDetails?._id,
                    name: userDetails?.name,
                    email: userDetails?.email,
                    profile_pic: userDetails?.profile_pic,
                    online: onlineUser.has(userId),
                };

                socket.emit('message-user', payload);  // Send the user details

                // Get previous message history
                const getConversationMessage = await ConversationModel.findOne({
                    "$or": [
                        { sender: user._id, receiver: userId },
                        { sender: userId, receiver: user._id }
                    ]
                }).populate('messages').sort({ updatedAt: -1 });

                // Send the messages to the user
                socket.emit('message', getConversationMessage?.messages || []);
            } catch (err) {
                console.error('Error fetching message page data:', err);
            }
        });

        /*** Event: new message */
        socket.on('new message', async (data) => {
            try {
                // Check if a conversation already exists between the two users
                let conversation = await ConversationModel.findOne({
                    "$or": [
                        { sender: data?.sender, receiver: data?.receiver },
                        { sender: data?.receiver, receiver: data?.sender }
                    ]
                });

                // If no conversation exists, create a new one
                if (!conversation) {
                    const createConversation = new ConversationModel({
                        sender: data?.sender,
                        receiver: data?.receiver,
                    });
                    conversation = await createConversation.save();
                }

                // Create a new message
                const message = new MessageModel({
                    text: data.text,
                    imageUrl: data.imageUrl,
                    videoUrl: data.videoUrl,
                    msgByUserId: data?.msgByUserId,
                });
                const saveMessage = await message.save();

                // Update the conversation with the new message
                await ConversationModel.updateOne({ _id: conversation._id }, {
                    "$push": { messages: saveMessage._id }
                });

                // Retrieve the updated conversation
                const getConversationMessage = await ConversationModel.findOne({
                    "$or": [
                        { sender: data?.sender, receiver: data?.receiver },
                        { sender: data?.receiver, receiver: data?.sender }
                    ]
                }).populate('messages').sort({ updatedAt: -1 });

                // Emit the updated conversation to both sender and receiver
                io.to(data?.sender).emit('message', getConversationMessage?.messages || []);
                io.to(data?.receiver).emit('message', getConversationMessage?.messages || []);

                // Send the updated conversation list to both users
                const conversationSender = await getConversation(data?.sender);
                const conversationReceiver = await getConversation(data?.receiver);

                io.to(data?.sender).emit('conversation', conversationSender);
                io.to(data?.receiver).emit('conversation', conversationReceiver);
            } catch (err) {
                console.error('Error handling new message:', err);
            }
        });

        /*** Event: sidebar (fetching user's conversations) */
        socket.on('sidebar', async (currentUserId) => {
            try {
                console.log("Fetching sidebar for user: ", currentUserId);

                const conversation = await getConversation(currentUserId);
                socket.emit('conversation', conversation);
            } catch (err) {
                console.error('Error fetching sidebar data:', err);
            }
        });

        /*** Event: seen (marking messages as seen) */
        socket.on('seen', async (msgByUserId) => {
            try {
                let conversation = await ConversationModel.findOne({
                    "$or": [
                        { sender: user._id, receiver: msgByUserId },
                        { sender: msgByUserId, receiver: user._id }
                    ]
                });

                const conversationMessageId = conversation?.messages || [];

                // Update the seen status of the messages
                await MessageModel.updateMany(
                    { _id: { "$in": conversationMessageId }, msgByUserId: msgByUserId },
                    { "$set": { seen: true } }
                );

                // Retrieve and emit updated conversations for both users
                const conversationSender = await getConversation(user._id.toString());
                const conversationReceiver = await getConversation(msgByUserId);

                io.to(user._id.toString()).emit('conversation', conversationSender);
                io.to(msgByUserId).emit('conversation', conversationReceiver);
            } catch (err) {
                console.error('Error updating message seen status:', err);
            }
        });

        /*** Event: disconnect */
        socket.on('disconnect', () => {
            if (user && user._id) {
                onlineUser.delete(user._id.toString());  // Remove user from the online users set
                console.log('User disconnected:', socket.id);
            }
        });

    } catch (error) {
        console.error('Error during connection setup:', error);
    }
});

module.exports = {
    app,
    server,
};
