const nodemailer = require('nodemailer');
const { OrderItem } = require('../models/orderItem');
const Product = require('../models/product');

// Function to send order confirmation email
async function sendOrderConfirmationEmail(clientEmail, orderItems, bEmail, BEPass, shipping) {
console.log(clientEmail,bEmail)
    // Create a nodemailer transporter
    const transporter = nodemailer.createTransport({
        host: 'smtpout.secureserver.net', // GoDaddy SMTP server
        port: 465, // GoDaddy SMTP port (465 or 587)
        secure: true, // true for 465, false for other ports
        auth: {
            user: bEmail, // Your GoDaddy email address
            pass: BEPass // Your GoDaddy email password
        }
    });

    try {
        console.log(orderItems);

        // Function to populate the order items
        async function populateOrderItems(orderItems) {
            return Promise.all(orderItems.map(async item => {
                // Populate the product field
                const populatedItem = await Product.findById(item.product);
                return {
                    ...item,
                    product: populatedItem
                };
            }));
        }

        // Populate the order items
        const populatedOrderItems = await populateOrderItems(orderItems);
        console.log(populatedOrderItems);

        // Create the order items HTML
        const orderItemsHtml = populatedOrderItems.map(item => `
            <tr>
                <td><img src="${item.product.images[0]}" alt="${item.product.productName}" style="height: 100px;"></td>
                <td>${item.product.productName}</td>
                <td>${item.quantity}</td>
                <td>R${item.product.price}</td>
                <td>R${item.quantity * item.product.price}</td>
            </tr>`).join('');

        // Calculate the total price
        const totalPrice = populatedOrderItems.reduce((total, item) => total + (item.quantity * item.product.price), 0);

        // Email HTML content
        const emailContent = `
            <p>Hi,</p>
            <p>Thank you for your order. Here are the details:</p>
            <table>
                <thead>
                    <tr>
                        <th></th>
                        <th>Product</th>
                        <th>Quantity</th>
                        <th>Price</th>
                        <th>Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${orderItemsHtml}
                </tbody>
            </table>
            <p>Subtotal: R${totalPrice}</p>
            <p>Shipping: R${shipping}</p>
            <p>Total Price: R${totalPrice + shipping}</p>
        `;
        console.log('about to send email');
        // Send email to client
        await transporter.sendMail({
            from: bEmail, // Your GoDaddy email address
            to: clientEmail, // Client's email address
            subject: 'Order Confirmation',
            html: emailContent
        });

        console.log('Order confirmation email sent to client successfully');

        // Send email to business (yourself)
        await transporter.sendMail({
            from: bEmail, // Your GoDaddy email address
            to: bEmail, // Business email (your email address)
            subject: 'New Order Received',
            html: emailContent // Reuse the same content
        });

        console.log('Order confirmation email sent to business successfully');

    } catch (error) {
        console.error('Error sending order confirmation email:', error);
        throw error; // Throw error to handle it in the calling function
    }
}
 

module.exports = { sendOrderConfirmationEmail };
