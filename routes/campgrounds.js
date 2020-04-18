var express = require("express");
var router = express.Router();
var Campground = require("../models/campground");
var middleware = require("../middleware");
var NodeGeocoder = require('node-geocoder');
var multer = require('multer');

/*======================================================
                    VARIABLES
=======================================================*/

var options = {
  provider: 'google',
  httpAdapter: 'https',
  apiKey: process.env.GEOCODER_API_KEY,
  formatter: null
};
 
var geocoder = NodeGeocoder(options);

/*======================================================
                    FUNCTIONS
=======================================================*/

/* Fuzzy Search */
function escapeRegex(text) {
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
};

/* Image Upload */
var storage = multer.diskStorage({
    filename: function(req, file, callback) {
        callback(null, Date.now() + file.originalname);
    }
});

var imageFilter = function (req, file, cb) {
    // accept image files only
    if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/i)) {
        return cb(new Error('Only image files are allowed!'), false);
    }
    cb(null, true);
};

var upload = multer({ storage: storage, fileFilter: imageFilter})

var cloudinary = require('cloudinary');

cloudinary.config({ 
    cloud_name: process.env.CLOUDNAME, 
    api_key: process.env.CLOUDINARY_API_KEY, 
    api_secret: process.env.CLOUDINARY_API_SECRET
});

/*======================================================
                    CAMPGROUND ROUTES
=======================================================*/

/* INDEX - show all campgrounds */
router.get("/", function(req, res){
    var noMatch = null;

    if(req.query.search){
        const regex = new RegExp(escapeRegex(req.query.search), 'gi');
        
        /* Search for name */
        Campground.find({name: regex}, function(err, allCampgrounds){
            if(err){
                console.log(err);
            } else {
                if(allCampgrounds.length < 1) {
                    noMatch = "No campgrounds match that query, please try again.";
                }
                /* console.log(allCampgrounds); List of all campgrounds from db */
                res.render("campgrounds/index", {campgrounds: allCampgrounds, page: 'campgrounds', noMatch: noMatch});
            }
        });
    } else {
        /* Get all campgrounds from the db */
        Campground.find({}, function(err, allCampgrounds){
            if(err){
                console.log(err);
            } else {
                /* console.log(allCampgrounds); List of all campgrounds from db */
                res.render("campgrounds/index", {campgrounds: allCampgrounds, page: 'campgrounds', noMatch: noMatch});
            }
        });
    }

});

/* CREATE - add new campground to database */
router.post("/", middleware.isLoggedIn, upload.single("image"), function(req, res) {
  // get data from form and add to campgrounds array
  var name = req.body.campground.name;
  //var image = req.body.image;
  var desc = req.body.campground.description;
  var author = {
      id: req.user._id,
      username: req.user.username
  };

  geocoder.geocode(req.body.location, function (err, data) {
    if (err || !data.length) {
        console.log(err);
        req.flash('error', 'Invalid address');
        return res.redirect('back');
    } 
    // add cloudinary url for the image to the campground object under image property
    cloudinary.v2.uploader.upload(req.file.path, function(err, result) {
        if(err) {
            req.flash("error", err.message);
            return res.redirect("back");
        }
        var image = result.secure_url;
        var imageId = result.public_id;


        var lat = data[0].latitude;
        var lng = data[0].longitude;
        var location = data[0].formattedAddress;
        var newCampground = {
            name: name,
            image: image,
            imageId: imageId,
            description: desc,
            author:author,
            location: location,
            lat: lat,
            lng: lng
        };
    
        // Create a new campground and save to DB
        Campground.create(newCampground, function(err, newlyCreated){
            if(err){
                req.flash("error", err.message);
                return res.redirect("back");
            } else {
                //redirect back to campgrounds page
                console.log(newlyCreated);
                res.redirect("/campgrounds/" + newlyCreated._id);
            }
        });
    });

  });

});

/* NEW - form to create new campground */
router.get("/new", middleware.isLoggedIn, function(req, res){
    res.render("campgrounds/new");
});

/* SHOW - show information about individual campground */
router.get("/:id", function(req, res){

    //  Associated the commends found by its ID with the campground object
    Campground.findById(req.params.id).populate("comments").exec(function(err, foundCampground){
        if(!err){
            //console.log(foundCampground);
            res.render("campgrounds/show", {campground: foundCampground});
        }
    });

});

/* EDIT */
router.get("/:id/edit", middleware.checkCampgroundOwnership, function(req, res){
    Campground.findById(req.params.id, function(err, foundCampground){
        if(err){
            req.flash("error", "Campground not found");
            res.redirect("/campgrounds");
            console.log(err);
        } else {
            res.render("campgrounds/edit", {campground: foundCampground});
        }
    });
});

/* UPDATE */
router.put("/:id", middleware.checkCampgroundOwnership, upload.single("image"), function(req, res){

  geocoder.geocode(req.body.location, function (err, data) {
    if (err || !data.length) {
      console.log(err);
      req.flash('error', 'Invalid address');
      return res.redirect('back');
    }

    Campground.findById(req.params.id, async function(err, campground){
        if(err){
            req.flash("error", err.message);
            res.redirect("back");
        } else {
            if(req.file) {
                try {
                    await cloudinary.v2.uploader.destroy(campground.imageId);
                    var result = await cloudinary.v2.uploader.upload(req.file.path);
                    campground.image = result.secure_url;
                    campground.imageId = result.public_id;
                } catch(err) {
                    req.flash("error", err.message);
                    return res.redirect("back");
                }
            }

            campground.lat         = data[0].latitude;
            campground.lng         = data[0].longitude;
            campground.location    = data[0].formattedAddress;
            campground.name        = req.body.campground.name;
            campground.price       = req.body.campground.price;
            campground.description = req.body.campground.description;
            
            campground.save();
            req.flash("success", "Successfully Updated Campground!");
            res.redirect("/campgrounds/" + campground._id);
        }
    });
  });
 
});

/* DELETE */
router.delete("/:id", middleware.checkCampgroundOwnership, function(req, res){
    Campground.findById(req.params.id, async function(err, campground){
        if(err){
            req.flash("error", "Campground not found");
            res.redirect("/campgrounds");
        } else {
            try {
                await cloudinary.v2.uploader.destroy(campground.imageId);
                campground.remove();
                req.flash('success', 'Campground deleted successfully!');
                res.redirect('/campgrounds');
            } catch(err) {
                if(err) {
                  req.flash("error", err.message);
                  return res.redirect("back");
                }
            }
        }
    });
});


module.exports = router;