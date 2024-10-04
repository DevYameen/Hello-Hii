const express = require('express');
const { Server } = require('socket.io');
const http = require('http');
const getUserDetailsFromToken = require('../helpers/getUserDetailsFromToken');
const UserModel = require('../models/UserModel');
const { ConversationModel, MessageModel } = require('../models/ConversationModel');
const getConversation = require('../helpers/getConversation');

const app = express();

/***socket connection */
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        credentials: true,
    },
});

/***
 * socket running at http://localhost:8080/
 */

// Online users set
const onlineUser = new Set();

io.on('connection', async (socket) => {
    console.log("connect User ", socket.id);

    const token = socket.handshake.auth.token;

    // Get current user details
    const user = await getUserDetailsFromToken(token);

    // Ensure the user and user._id exist before using them
    if (user && user._id) {
        // Create a room for the user based on their _id
        socket.join(user._id.toString());
        onlineUser.add(user._id.toString());

        // Notify all clients about the online users
        io.emit('onlineUser', Array.from(onlineUser));
    } else {
        console.log('Error: Unable to get user details from token.');
        return;  // Exit early if user details are invalid
    }

    // Handle message-page event
    socket.on('message-page', async (userId) => {
        console.log('userId', userId);
        const userDetails = await UserModel.findById(userId).select("-password");

        const payload = {
            _id: userDetails?._id,
            name: userDetails?.name,
            email: userDetails?.email,
            profile_pic: userDetails?.profile_pic,
            online: onlineUser.has(userId),
        };
        socket.emit('message-user', payload);

        // Get previous message history
        const getConversationMessage = await ConversationModel.findOne({
            "$or": [
                { sender: user._id, receiver: userId },
                { sender: userId, receiver: user._id }
            ]
        }).populate('messages').sort({ updatedAt: -1 });

        socket.emit('message', getConversationMessage?.messages || []);
    });

    // Handle new message event
    socket.on('new message', async (data) => {
        // Check if a conversation exists between the two users
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
    });

    // Handle sidebar event
    socket.on('sidebar', async (currentUserId) => {
        console.log("current user", currentUserId);

        const conversation = await getConversation(currentUserId);
        socket.emit('conversation', conversation);
    });

    // Handle seen event
    socket.on('seen', async (msgByUserId) => {
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
    });

    // Handle disconnect event
    socket.on('disconnect', () => {
        if (user && user._id) {
            onlineUser.delete(user._id.toString());
            console.log('disconnect user', socket.id);
        }
    });
});

module.exports = {
    app,
    server,
};
