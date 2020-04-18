var express    = require("express");
var router     = express.Router();
var User       = require("../models/user");
var Campground = require("../models/campground");
var passport   = require("passport");
var async      = require("async");
var nodemailer = require("nodemailer");
var crypto     = require("crypto");


router.get("/", function(req, res){
    res.render("landingpage");
});

/*======================================================
                     AUTH ROUTES
=======================================================*/

/* SHOW - register page form */
router.get("/register", function(req, res){
    res.render("register", {page: 'register'});
});

/* Handles signup logic */
router.post("/register", function(req, res){
    var newUser = new User({
        username: req.body.username,
        email: req.body.email,
        avatar: req.body.avatar,
        bio: req.body.bio
    });
    
    /* Should probably use an env variable for this? */
    if(req.body.admincode == "secretcode1234") {
        newUser.isAdmin = true;
    }
    
    User.register(newUser, req.body.password, function(err, user){
        if(err){
            console.log(err);
            return res.render("register", {error: err.message});
        } else {
            // Log the user in
            passport.authenticate("local")(req, res, function(){
                req.flash("success", "Successfully Signed Up! Welcome " + user.username);
                res.redirect("/campgrounds");
            });
        }
    });
});

/* SHOW - Login form */
router.get("/login", function(req, res){
    res.render("login", {page: 'login'});
});

/* Handles the login logic */
router.post("/login", passport.authenticate("local", {
        successRedirect: "/campgrounds",
        failureRedirect: "/login"
    }), function(req, res){

});

/* LOGOUT */
router.get("/logout", function(req, res){
    req.logout();
    req.flash("success", "Logged you out!");
    res.redirect("/campgrounds");
});

/*======================================================
                        USER PROFILE
=======================================================*/

/* SHOW - User profile */
router.get("/user/:id", function(req, res) {
    User.findById(req.params.id, function(err, foundUser){
        if(err) {
            req.flash("error", "Error finding user");
            res.redirect("/");
        } else {
            /* Find the campgrounds that the user created */
            Campground.find().where("author.id").equals(foundUser._id).exec(function(err, campgrounds){
                if(err){
                    req.flash("error", "Error finding user");
                    res.redirect("back");
                } else {
                    res.render("users/show", {user: foundUser, campgrounds: campgrounds});
                }
            });
        }
    });
});

/* EDIT - User profile */
router.get("/user/edit/:id", function(req, res){
    User.findById(req.params.id, function(err, foundUser){
        if(err){
            req.flash("error", "Error finding user");
            res.redirect("back");
        } else {
            res.render("users/edit", {user: foundUser});
        }
    });
});

/* UPDATE - User profile */
router.put("/user/:id", function(req, res){
    User.findByIdAndUpdate(req.params.id, req.body.user, function(err, user){
        if(err){
            req.flash("error", "Error finding user");
            res.redirect("back");
        } else {
            req.flash("success", "Successfully updated your profile!");
            res.redirect("/user/" + user._id);
        }
    });
});

/*======================================================
                    PASSWORD RESET
=======================================================*/

/* GET Forgot page */
router.get("/forgot", function(req, res){
    res.render("forgot");
});

/* POST */
router.post('/forgot', function(req, res, next) {
    async.waterfall([
        function(done) {
            crypto.randomBytes(20, function(err, buf) {
                var token = buf.toString('hex');
                done(err, token);
            });
        },
        function(token, done) {
            User.findOne({ email: req.body.email }, function(err, user) {
                if(err) {
                    req.flash("error", "Error finding user by email");
                    res.redirect("back");
                }
                if (!user) {
                    req.flash('error', 'No account with that email address exists.');
                    return res.redirect('/forgot');
                }

                user.resetPasswordToken = token;
                user.resetPasswordExpires = Date.now() + 3600000; // 1 hour

                user.save(function(err) {
                    done(err, token, user);
                });
            });
        },
        function(token, user, done) {
            var smtpTransport = nodemailer.createTransport({
                service: 'Gmail', 
                auth: {
                    user: process.env.GMAIL,
                    pass: process.env.GMAILPW
                }
            });
            var mailOptions = {
                to: user.email,
                from: process.env.GMAIL,
                subject: 'YelpCamp - JD Node.js Password Reset',
                text: 'You are receiving this because you (or someone else) have requested the reset of the password for your account.\n\n' +
                    'Please click on the following link, or paste this into your browser to complete the process:\n\n' +
                    'http://' + req.headers.host + '/reset/' + token + '\n\n' +
                    'If you did not request this, please ignore this email and your password will remain unchanged.\n'
            };
            smtpTransport.sendMail(mailOptions, function(err) {
                console.log('mail sent');
                req.flash('success', 'An e-mail has been sent to ' + user.email + ' with further instructions.');
                done(err, 'done');
            });
        }
    ], function(err) {
        if (err) return next(err);
        res.redirect('/forgot');
    });
});

/* GET New Password Page */
router.get('/reset/:token', function(req, res) {
    User.findOne({ resetPasswordToken: req.params.token, resetPasswordExpires: { $gt: Date.now() } }, function(err, user) {
        if(err) {
            req.flash("error", "Error finding password token");
            res.redirect("back");
        }
        if (!user) {
            req.flash('error', 'Password reset token is invalid or has expired.');
            return res.redirect('/forgot');
        }
            res.render('reset', {token: req.params.token});
    });
});

/* POST New Password */
router.post('/reset/:token', function(req, res) {
    async.waterfall([
        function(done) {
            User.findOne({ resetPasswordToken: req.params.token, resetPasswordExpires: { $gt: Date.now() } }, function(err, user) {
                if(err) {
                    req.flash("error", "Error find user with token");
                    res.redirect("back");
                }
                if (!user) {
                    req.flash('error', 'Password reset token is invalid or has expired.');
                    return res.redirect('back');
                }
                if(req.body.password === req.body.confirm) {
                    user.setPassword(req.body.password, function(err) {
                        if(err) {
                            req.flash("error", "Error setting password");
                            res.redirect("back");
                        }
                        user.resetPasswordToken = undefined;
                        user.resetPasswordExpires = undefined;
    
                        user.save(function(err) {
                            if(err) {
                                req.flash("error", "Error saving password to user");
                                res.redirect("back");
                            }
                            req.logIn(user, function(err) {
                                done(err, user);
                            });
                        });
                    });
                } else {
                    req.flash("error", "Passwords do not match.");
                    return res.redirect('back');
                }
            });
        },
        function(user, done) {
            var smtpTransport = nodemailer.createTransport({
                service: 'Gmail', 
                auth: {
                    user: process.env.GMAIL,
                    pass: process.env.GMAILPW
                }
            });
            var mailOptions = {
                to: user.email,
                from: process.env.GMAIL,
                subject: 'Your password has been changed',
                text: 'Hello,\n\n' +
                'This is a confirmation that the password for your account ' + user.email + ' has just been changed.\n'
            };
            smtpTransport.sendMail(mailOptions, function(err) {
                req.flash('success', 'Success! Your password has been changed.');
                done(err);
            });
        }
    ], function(err) {
        if(err) {
            req.flash("error", "Error with setting your new password");
            res.redirect("back");
        }
        res.redirect('/campgrounds');
    });
});

module.exports = router;