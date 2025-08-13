const { config } = require('dotenv');
var express = require('express');
const app = express();
//var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
const bodyParser = require("body-parser");
const morgan = require('morgan');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv/config');
const authJwt = require('./helpers/jwt');
const errorHandler = require('./helpers/error-handler');
const http = require('http');
const socketIo = require('socket.io'); // use correct import
const server = http.createServer(app); // Create HTTP server with Express app
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});
app.use(cors());
app.options('*',cors());
app.disable('x-powered-by');




//Routers
var usersRoutes = require('./routes/user');
var propertyRoutes = require('./routes/properties');
var messageRoutes = require('./routes/messages');
var reviewRoutes= require('./routes/reviews');
var { router: cleaningServiceRouter } = require('./routes/cleaningService');
//Old routers
var customerRoutes = require('./routes/customer');
var clientRoutes = require('./routes/client');
var productRoutes = require('./routes/product');
var indexRouter = require('./routes/index');
var sizeRoutes = require('./routes/sizes');
var orderRoutes = require('./routes/orders');
var emailSubscriptionsRoutes = require('./routes/emailSubscriptions');
var wishListRouter = require('./routes/wishList');
var categoriesRouter = require('./routes/categories');
var productSalesRouter = require('./routes/productsale');
var discountCodeRouter = require('./routes/discountCode');
var bookingsRouter = require('./routes/booking');
var staffRouter = require('./routes/staff');
var serviceRouter = require('./routes/services');
var adminRouter = require('./routes/admin');
//Middleware
app.use(express.json());
app.use(morgan('tiny'));
app.use('/api/v1', authJwt());
app.use(authJwt());
app.use("/public/uploads", express.static(__dirname + "/public/uploads"));
app.use(errorHandler);
//----
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
//app.use(express.static(path.join(__dirname, 'public')));

// adding whats app



app.use('/', indexRouter);




app.use(cors());
app.options('*',cors());


 const api = process.env.API_URL;
 app.use(`${api}/users`,usersRoutes);
 app.use(`${api}/reviews`, reviewRoutes);
 app.use(`${api}/messages`, messageRoutes);
 app.use(`${api}/properties`, propertyRoutes);
 app.use(`${api}/cleaningService`, cleaningServiceRouter);



 app.use(`${api}/wishlists`, wishListRouter);
 app.use(`${api}/categories`, categoriesRouter);
 app.use(`${api}/emailsub`, emailSubscriptionsRoutes);
 app.use(`${api}/orders`, orderRoutes);
 app.use(`${api}/products`, productRoutes);
 app.use(`${api}/customer`, customerRoutes);
 app.use(`${api}/client`, clientRoutes);
 app.use(`${api}/size`, sizeRoutes);
 app.use(`${api}/productsales`, productSalesRouter);
 app.use(`${api}/discountcode`, discountCodeRouter);
 app.use(`${api}/bookings`, bookingsRouter);
 app.use(`${api}/staff`, staffRouter);
 app.use(`${api}/services`, serviceRouter);
 app.use(`${api}/admin`, adminRouter);
 
// mongoose.connect(process.env.CONNECTION_STRING,{ useNewUrlParser: true,useUnifiedTopology: true, dbName: 'KhanaConnect_DevDB',} )
 mongoose.connect(process.env.CONNECTION_STRING,{ useNewUrlParser: true,useUnifiedTopology: true, dbName: 'KhanaConnect_ProdDB'} )
.then(()=>{
    console.log('Database Connection is ready...')
})
.catch((err)=>{
    console.log(err);
})


io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('joinService', (serviceId) => {
        socket.join(serviceId);
        console.log(`User joined service room: ${serviceId}`);
    });

    socket.on('sendMessage', async (data) => {
        try {
            const Message = require('./models/Message.model');
            const newMessage = new Message(data);
            const savedMessage = await newMessage.save();

            // Emit to everyone in the same service chat
            io.to(data.service).emit('newMessage', savedMessage);
        } catch (err) {
            console.error('Failed to save message:', err);
            socket.emit('error', 'Failed to send message');
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});


const PORT = process.env.PORT || 3000;
//Server
server.listen(PORT, ()=>{
    console.log('server is running http://localhost:3000');
})
